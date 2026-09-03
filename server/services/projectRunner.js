/**
 * Apollo — Multi-file project runner
 *
 * Writes a virtual file tree to a throwaway directory and runs a FIXED,
 * server-authored command inside it. This is what makes cross-file imports
 * (`from utils import add`, `require('./helper')`, `#include "math.h"`) resolve.
 *
 * SECURITY INVARIANTS (see plans/multi-file-workspace/05-security-model.md):
 *   1. Every incoming path is validated and confined to the session directory.
 *      The browser blocking bad names is not a defence — anyone can POST directly.
 *   2. Commands are argv arrays via spawnSafe. No shell, ever. Compile+run is two
 *      separate spawns, never `&&`-chained through a shell.
 *   3. Child processes never inherit process.env (see execSafe.buildSafeEnv).
 *   4. Hard caps on file count, total bytes, wall-clock time and output size.
 *
 * NOT protected against: user code reading server files by absolute path, or
 * making outbound network calls. Only container isolation fixes that.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  spawnSafe, killTree, isWindows,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES,
} from './execSafe.js';

export const MAX_FILES = 100;
export const MAX_TOTAL_BYTES = 1_000_000;      // 1MB of source
export const COMPILE_TIMEOUT_MS = 20_000;      // g++/javac are slower than a script
const TMP_PREFIX = 'apollo-proj-';

const PYTHON_CMD = isWindows ? 'python' : 'python3';

/* ═══════════════════════════════════════
   1. Path validation
   ═══════════════════════════════════════ */

/**
 * Validates a single client-supplied relative path.
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function validateRelPath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return { ok: false, error: 'File path is empty' };
  }
  if (relPath.length > 400) {
    return { ok: false, error: 'File path is too long' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(relPath)) {
    return { ok: false, error: 'File path contains control characters' };
  }
  // Normalise separators before any further reasoning.
  const unified = relPath.replace(/\\/g, '/');

  if (unified.startsWith('/')) {
    return { ok: false, error: 'Absolute paths are not allowed' };
  }
  if (/^[a-zA-Z]:/.test(unified)) {
    return { ok: false, error: 'Drive-letter paths are not allowed' };
  }
  if (unified.startsWith('//')) {
    return { ok: false, error: 'UNC paths are not allowed' };
  }

  const segments = unified.split('/').filter((s) => s.length > 0);
  if (!segments.length) {
    return { ok: false, error: 'File path is empty' };
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return { ok: false, error: `Path traversal is not allowed: "${relPath}"` };
    }
  }

  return { ok: true, path: segments.join('/') };
}

/**
 * Validates the whole payload before a single byte is written to disk.
 * @returns {{ ok: boolean, files?: {path,content}[], error?: string }}
 */
export function validateProjectFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: 'No files provided' };
  }
  if (files.length > MAX_FILES) {
    return { ok: false, error: `Too many files (max ${MAX_FILES})` };
  }

  let total = 0;
  const seen = new Set();
  const clean = [];

  for (const file of files) {
    const check = validateRelPath(file?.path);
    if (!check.ok) return { ok: false, error: check.error };

    const content = typeof file.content === 'string' ? file.content : '';
    total += Buffer.byteLength(content, 'utf8');
    if (total > MAX_TOTAL_BYTES) {
      return { ok: false, error: `Project is too large (max ${MAX_TOTAL_BYTES / 1000}KB of source)` };
    }

    const key = check.path.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate file path: "${check.path}"` };
    }
    seen.add(key);

    clean.push({ path: check.path, content });
  }

  return { ok: true, files: clean };
}

/* ═══════════════════════════════════════
   2. Writing the sandbox directory
   ═══════════════════════════════════════ */

async function writeProjectFiles(files) {
  // mkdtemp (not a Date.now() name) avoids collisions between concurrent runs.
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), TMP_PREFIX));

  for (const file of files) {
    const target = path.resolve(sessionDir, file.path);

    // The decisive containment check. Even after validation, assert the resolved
    // path really is inside the session dir before writing.
    if (target !== sessionDir && !target.startsWith(sessionDir + path.sep)) {
      await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => null);
      throw Object.assign(new Error('Invalid file path'), { statusCode: 400 });
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }

  return sessionDir;
}

export async function cleanupSession(sessionDir) {
  if (!sessionDir) return;
  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => null);
}

/**
 * Removes orphaned project dirs left behind by a crash or hard restart.
 * Called once at server boot.
 */
export async function sweepOrphanedSessions() {
  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    const stale = entries.filter((e) => e.isDirectory() && e.name.startsWith(TMP_PREFIX));
    for (const dir of stale) {
      await fs.rm(path.join(os.tmpdir(), dir.name), { recursive: true, force: true }).catch(() => null);
    }
    if (stale.length) {
      console.log(`[projectRunner] Swept ${stale.length} orphaned project director${stale.length === 1 ? 'y' : 'ies'}`);
    }
  } catch {
    /* non-fatal */
  }
}

/* ═══════════════════════════════════════
   3. Entry point detection
   ═══════════════════════════════════════ */

const isRootLevel = (p) => !p.includes('/');

function findByPreference(files, ext, preferred) {
  const matching = files.filter((f) => f.path.toLowerCase().endsWith(ext));
  if (!matching.length) return null;

  for (const name of preferred) {
    const hit = matching.find((f) => f.path.toLowerCase() === name);
    if (hit) return hit.path;
  }
  // Prefer a root-level file over something buried in a subfolder.
  const root = matching.find((f) => isRootLevel(f.path));
  return (root ?? matching[0]).path;
}

/** Finds the Java file declaring `public static void main`. */
function findJavaMain(files) {
  const javaFiles = files.filter((f) => f.path.toLowerCase().endsWith('.java'));
  const withMain = javaFiles.find((f) => /public\s+static\s+void\s+main\s*\(/.test(f.content));
  return withMain ?? javaFiles[0] ?? null;
}

function findCppMain(files) {
  const cppFiles = files.filter((f) => /\.(cpp|cc|cxx|c)$/i.test(f.path));
  const withMain = cppFiles.find((f) => /\bint\s+main\s*\(/.test(f.content));
  return (withMain ?? cppFiles[0])?.path ?? null;
}

/**
 * @returns {{ ok: boolean, entry?: string, error?: string }}
 */
export function resolveEntry(files, language, requested) {
  if (requested) {
    const check = validateRelPath(requested);
    if (!check.ok) return { ok: false, error: check.error };
    if (!files.some((f) => f.path === check.path)) {
      return { ok: false, error: `Entry file "${requested}" is not in the project` };
    }
    return { ok: true, entry: check.path };
  }

  let entry = null;

  switch (language) {
    case 'javascript': {
      entry = findByPreference(files, '.js', ['main.js', 'index.js']);
      if (!entry) {
        // Respect package.json "main" if present.
        const pkg = files.find((f) => f.path === 'package.json');
        if (pkg) {
          try {
            const main = JSON.parse(pkg.content)?.main;
            if (main) {
              const check = validateRelPath(main);
              if (check.ok && files.some((f) => f.path === check.path)) entry = check.path;
            }
          } catch { /* malformed package.json — ignore */ }
        }
      }
      break;
    }
    case 'python':
      entry = findByPreference(files, '.py', ['main.py', 'app.py']);
      break;
    case 'java':
      entry = findJavaMain(files)?.path ?? null;
      break;
    case 'cpp':
      entry = findCppMain(files);
      break;
    default:
      return { ok: false, error: `Unsupported language: ${language}` };
  }

  if (!entry) {
    const hint = {
      javascript: 'Create a main.js or index.js',
      python: 'Create a main.py',
      java: 'Create a .java file with a public static void main method',
      cpp: 'Create a .cpp file with an int main() function',
    }[language];
    return { ok: false, error: `No entry point found. ${hint}.` };
  }

  return { ok: true, entry };
}

/* ═══════════════════════════════════════
   4. Command templates
   Argv arrays only. No shell. Compile and run are separate steps.
   ═══════════════════════════════════════ */

/** Derives the fully-qualified class name Java needs to launch. */
function javaMainClass(files, entryPath) {
  const file = files.find((f) => f.path === entryPath);
  const fileBase = path.basename(entryPath).replace(/\.java$/i, '');
  if (!file) return fileBase;

  const pkgMatch = file.content.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m);
  return pkgMatch ? `${pkgMatch[1]}.${fileBase}` : fileBase;
}

/**
 * @returns {{ ok: boolean, steps?: object[], error?: string }}
 * Each step: { cmd, args, label, timeoutMs, isCompile }
 */
export function buildSteps(language, entry, files, sessionDir) {
  const safeEntry = (entry.startsWith('./') || entry.startsWith('.\\')) ? entry : `./${entry}`;

  switch (language) {
    case 'javascript':
      return { ok: true, steps: [{ cmd: 'node', args: [safeEntry], label: 'node', timeoutMs: DEFAULT_TIMEOUT_MS }] };

    case 'python':
      // -u is essential: without it CPython block-buffers stdout when piped,
      // so streaming output would arrive in one lump at exit.
      return { ok: true, steps: [{ cmd: PYTHON_CMD, args: ['-u', safeEntry], label: 'python', timeoutMs: DEFAULT_TIMEOUT_MS }] };

    case 'cpp': {
      const sources = files.filter((f) => /\.(cpp|cc|cxx|c)$/i.test(f.path)).map((f) => f.path);
      if (!sources.length) return { ok: false, error: 'No C++ source files found' };

      const binName = isWindows ? 'apollo_app.exe' : 'apollo_app';
      return {
        ok: true,
        steps: [
          {
            cmd: 'g++',
            args: ['-std=c++17', '-O0', ...sources, '-o', binName],
            label: 'g++',
            timeoutMs: COMPILE_TIMEOUT_MS,
            isCompile: true,
          },
          {
            // Absolute path: the sandbox dir is not on PATH.
            cmd: path.join(sessionDir, binName),
            args: [],
            label: 'run',
            timeoutMs: DEFAULT_TIMEOUT_MS,
          },
        ],
      };
    }

    case 'java': {
      const sources = files.filter((f) => f.path.toLowerCase().endsWith('.java')).map((f) => f.path);
      if (!sources.length) return { ok: false, error: 'No Java source files found' };

      const mainClass = javaMainClass(files, entry);

      // Java requires a public class name to match its filename; catching this
      // here beats a cryptic ClassNotFoundException from the JVM.
      const entryFile = files.find((f) => f.path === entry);
      const expected = path.basename(entry).replace(/\.java$/i, '');
      if (entryFile && new RegExp(`public\\s+(final\\s+|abstract\\s+)?class\\s+(\\w+)`).test(entryFile.content)) {
        const declared = entryFile.content.match(/public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/)[1];
        if (declared !== expected) {
          return {
            ok: false,
            error: `Java requires the public class name to match the filename: "${declared}" is declared in "${path.basename(entry)}". Rename the file to "${declared}.java".`,
          };
        }
      }

      return {
        ok: true,
        steps: [
          { cmd: 'javac', args: ['-d', '.', ...sources], label: 'javac', timeoutMs: COMPILE_TIMEOUT_MS, isCompile: true },
          { cmd: 'java', args: ['-cp', '.', mainClass], label: 'run', timeoutMs: DEFAULT_TIMEOUT_MS },
        ],
      };
    }

    default:
      return { ok: false, error: `Unsupported language: ${language}` };
  }
}

/* ═══════════════════════════════════════
   5. Runners
   ═══════════════════════════════════════ */

/**
 * Streaming core. Emits output as it is produced.
 *
 * @param {object}   opts    { files, language, entry, stdin }
 * @param {object}   handlers
 *   onStart({ entry, command, language })
 *   onOutput({ stream, chunk })
 *   onExit({ exitCode, timedOut, truncated })
 *   onError({ message })
 *   onSpawn(child)   — lets callers keep a handle for kill support
 *
 * @returns {Promise<{ exitCode, timedOut, truncated } | null>}
 */
export async function runProjectStreaming(
  { files: rawFiles, language, entry: requestedEntry, stdin = '', interactive = false },
  handlers = {}
) {
  const { onStart, onOutput, onExit, onError, onSpawn } = handlers;

  const validation = validateProjectFiles(rawFiles);
  if (!validation.ok) {
    onError?.({ message: validation.error, statusCode: 400 });
    return null;
  }
  const files = validation.files;

  const entryRes = resolveEntry(files, language, requestedEntry);
  if (!entryRes.ok) {
    onError?.({ message: entryRes.error, statusCode: 400 });
    return null;
  }
  const entry = entryRes.entry;

  let sessionDir = null;
  try {
    sessionDir = await writeProjectFiles(files);

    const stepsRes = buildSteps(language, entry, files, sessionDir);
    if (!stepsRes.ok) {
      onError?.({ message: stepsRes.error, statusCode: 400 });
      return null;
    }

    const steps = stepsRes.steps;
    const runStep = steps[steps.length - 1];
    onStart?.({
      entry,
      language,
      command: `${runStep.cmd === path.join(sessionDir, path.basename(runStep.cmd)) ? `./${path.basename(runStep.cmd)}` : runStep.cmd} ${runStep.args.join(' ')}`.trim(),
    });

    let budget = DEFAULT_MAX_OUTPUT_BYTES;
    let last = null;

    for (const step of steps) {
      const result = await spawnSafe({
        cmd: step.cmd,
        args: step.args,
        cwd: sessionDir,
        // Only the final (run) step receives stdin; a compiler must not consume it.
        stdin: step.isCompile ? '' : stdin,
        timeoutMs: step.timeoutMs,
        maxOutputBytes: budget,
        onOutput,
        onSpawn,
        // Compile steps are never interactive — only the program itself reads input.
        interactive: interactive && !step.isCompile,
      });

      budget -= Buffer.byteLength(result.stdout + result.stderr, 'utf8');
      if (budget < 0) budget = 0;
      last = result;

      if (result.timedOut) {
        const msg = step.isCompile
          ? `\n[compilation timed out after ${step.timeoutMs / 1000}s]\n`
          : `\n[execution timed out after ${step.timeoutMs / 1000}s]\n`;
        onOutput?.({ stream: 'stderr', chunk: msg });
        break;
      }

      // A failed compile means there is nothing to run — stop here rather than
      // launching a stale or nonexistent binary.
      if (result.exitCode !== 0) {
        if (step.isCompile) {
          onOutput?.({ stream: 'stderr', chunk: `\n[${step.label} failed — not running]\n` });
        }
        break;
      }
    }

    const summary = {
      exitCode: last?.exitCode ?? -1,
      timedOut: !!last?.timedOut,
      truncated: !!last?.truncated,
    };
    onExit?.(summary);
    return summary;
  } catch (err) {
    onError?.({ message: err.message, statusCode: err.statusCode ?? 500 });
    return null;
  } finally {
    await cleanupSession(sessionDir);
  }
}

/**
 * Buffered wrapper for the HTTP route. Collects everything, returns one object.
 * @returns {Promise<{stdout,stderr,exitCode,timedOut,truncated,entry}>}
 */
export async function runProject(opts) {
  let stdout = '';
  let stderr = '';
  let entry = null;
  let failure = null;

  const summary = await runProjectStreaming(opts, {
    onStart: (info) => { entry = info.entry; },
    onOutput: ({ stream, chunk }) => {
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    },
    onError: (err) => { failure = err; },
  });

  if (failure) {
    throw Object.assign(new Error(failure.message), { statusCode: failure.statusCode ?? 500 });
  }

  return {
    stdout,
    stderr,
    exitCode: summary?.exitCode ?? -1,
    timedOut: !!summary?.timedOut,
    truncated: !!summary?.truncated,
    entry,
  };
}

export { killTree, PYTHON_CMD };

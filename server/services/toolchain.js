/**
 * Apollo — Toolchain detection
 *
 * Probes for compilers/interpreters ONCE and caches the result. Runs at boot so
 * a misconfigured host is obvious immediately rather than when a user hits Run.
 *
 * Exposed via /health so the client can annotate languages it cannot run here.
 */

import { spawnSafe, isWindows } from './execSafe.js';
import os from 'os';

const PROBE_TIMEOUT_MS = 8000;

const PROBES = {
  node:   { cmd: 'node',                        args: ['--version'] },
  python: { cmd: isWindows ? 'python' : 'python3', args: ['--version'] },
  gpp:    { cmd: 'g++',                         args: ['--version'] },
  javac:  { cmd: 'javac',                       args: ['-version'] },
  java:   { cmd: 'java',                        args: ['-version'] },
};

let cache = null;
let inflight = null;

async function probe(cmd, args) {
  try {
    const result = await spawnSafe({
      cmd,
      args,
      cwd: os.tmpdir(),
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 8000,
    });

    if (result.spawnError || result.timedOut) return { available: false, version: null };

    // Some tools print --version to stderr (javac/java historically do).
    const text = `${result.stdout}${result.stderr}`.trim();

    // A Windows Store / version-manager stub can exit 0 while printing nothing
    // useful, or try to download a runtime. Treat that as unavailable rather
    // than letting users see "Downloading: ....." as their program output.
    if (/Downloading:/i.test(text) || !text) return { available: false, version: null };
    if (result.exitCode !== 0) return { available: false, version: null };

    return { available: true, version: text.split('\n')[0].slice(0, 80) };
  } catch {
    return { available: false, version: null };
  }
}

/**
 * @returns {Promise<{node,python,gpp,javac,java, languages:{javascript,python,cpp,java}}>}
 */
export async function detectToolchain({ force = false } = {}) {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const entries = await Promise.all(
      Object.entries(PROBES).map(async ([key, { cmd, args }]) => [key, await probe(cmd, args)])
    );
    const tools = Object.fromEntries(entries);

    cache = {
      ...tools,
      // What each language actually needs to work end to end.
      languages: {
        javascript: { local: tools.node.available, multiFile: tools.node.available },
        python: { local: tools.python.available, multiFile: tools.python.available },
        // C++/Java need a local compiler for multi-file; single-file can fall
        // back to the Judge0 sandbox.
        cpp: { local: tools.gpp.available, multiFile: tools.gpp.available, remoteFallback: true },
        java: {
          local: tools.javac.available && tools.java.available,
          multiFile: tools.javac.available && tools.java.available,
          remoteFallback: true,
        },
      },
    };
    inflight = null;
    return cache;
  })();

  return inflight;
}

export function formatToolchainReport(toolchain) {
  const mark = (ok) => (ok ? 'yes' : 'NO');
  const l = toolchain.languages;
  return [
    '[toolchain] local runtimes detected:',
    `            node   ${mark(toolchain.node.available)}${toolchain.node.version ? `  (${toolchain.node.version})` : ''}`,
    `            python ${mark(toolchain.python.available)}${toolchain.python.version ? `  (${toolchain.python.version})` : ''}`,
    `            g++    ${mark(toolchain.gpp.available)}${toolchain.gpp.version ? `  (${toolchain.gpp.version})` : ''}`,
    `            javac  ${mark(toolchain.javac.available)}${toolchain.javac.version ? `  (${toolchain.javac.version})` : ''}`,
    '[toolchain] multi-file support: ' +
      Object.entries(l).map(([lang, v]) => `${lang}=${v.multiFile ? 'yes' : 'no'}`).join('  '),
    (!l.cpp.multiFile || !l.java.multiFile)
      ? '[toolchain] note: C++/Java lack a local compiler here — single-file runs will use the Judge0 fallback.'
      : '',
  ].filter(Boolean).join('\n');
}

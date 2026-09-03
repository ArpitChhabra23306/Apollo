/**
 * Apollo — Single-file code runner
 *
 * Used by POST /api/code/run (the classic single-snippet path, the AI test
 * generator, and the interview pages).
 *
 * Multi-file projects go through projectRunner.js instead.
 *
 * All execution funnels through execSafe.js, which guarantees:
 *   - no shell (spawn with argv array)
 *   - no process.env inheritance (secrets are not readable by user code)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSafe, isWindows, DEFAULT_TIMEOUT_MS } from './execSafe.js';

const JUDGE0_API = 'https://ce.judge0.com';

const JUDGE0_LANGUAGE_MAP = {
  java: 62,
  cpp: 54,
};

export const PYTHON_CMD = isWindows ? 'python' : 'python3';

const LOCAL_RUNNERS = {
  javascript: { ext: 'js', cmd: 'node',      args: (file) => [file] },
  python:     { ext: 'py', cmd: PYTHON_CMD,  args: (file) => ['-u', file] },
};

/**
 * Executes a single file of code and returns its output.
 * JavaScript and Python run locally; C++/Java fall back to the Judge0 sandbox.
 */
export async function executeCode(code, language, stdin = '') {
  const runner = LOCAL_RUNNERS[language];

  if (runner) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-run-'));
    const fileName = `main.${runner.ext}`;
    const filePath = path.join(dir, fileName);

    try {
      await fs.writeFile(filePath, code, 'utf8');

      const result = await spawnSafe({
        cmd: runner.cmd,
        // Relative filename + cwd, so nothing host-specific leaks into errors.
        args: runner.args(fileName),
        cwd: dir,
        stdin,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });

      return {
        stdout: result.stdout,
        stderr: result.timedOut
          ? `${result.stderr}\n[execution timed out after ${DEFAULT_TIMEOUT_MS / 1000}s]`.trim()
          : result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
    }
  }

  // ── Judge0 fallback for compiled languages ──
  const runtimeId = JUDGE0_LANGUAGE_MAP[language];
  if (!runtimeId) {
    throw new Error(`Execution runner is not configured for: ${language}.`);
  }

  return runOnJudge0(code, runtimeId, stdin);
}

/**
 * Submits source to Judge0 CE and polls until the verdict is ready.
 * Exported so projectRunner.js can reuse it for the no-local-toolchain fallback.
 */
export async function runOnJudge0(code, runtimeId, stdin = '') {
  const submitRes = await fetch(`${JUDGE0_API}/submissions?base64_encoded=false&wait=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_code: code,
      language_id: runtimeId,
      stdin: stdin || '',
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Judge0 submit error: ${submitRes.status} — ${errText}`);
  }

  const { token } = await submitRes.json();
  if (!token) {
    throw new Error('No token returned from Judge0 — the service may be rate limiting requests.');
  }

  let result = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));

    const pollRes = await fetch(
      `${JUDGE0_API}/submissions/${token}?base64_encoded=false&fields=stdout,stderr,status,exit_code,compile_output`
    );

    if (!pollRes.ok) {
      throw new Error(`Judge0 poll error: ${pollRes.status}`);
    }

    result = await pollRes.json();
    if (result.status?.id >= 3) break;
  }

  if (!result || result.status?.id < 3) {
    throw new Error('Code execution timed out');
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || result.compile_output || '',
    exitCode: result.exit_code ?? -1,
    timedOut: false,
    truncated: false,
  };
}

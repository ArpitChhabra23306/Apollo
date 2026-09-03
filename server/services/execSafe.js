/**
 * Apollo — Safe child process execution
 *
 * Every code-execution path in Apollo funnels through this module. Two hard rules:
 *
 *  1. NEVER use `exec` with an interpolated string. We always `spawn` with an argv
 *     array, so no shell is involved and filenames/paths cannot inject commands.
 *
 *  2. NEVER inherit `process.env`. Child processes get an explicit minimal
 *     environment. Without this, any user can run `import os; print(os.environ)`
 *     and read OPENAI_API_KEY, JWT_SECRET, MONGO_URI (with the DB password) and
 *     EMAIL_PASS straight out of the output panel.
 *
 * Known limitation: this does not provide process isolation. User code still runs
 * as the server's OS user and can read files by absolute path. Container isolation
 * is the only real fix — see plans/multi-file-workspace/05-security-model.md.
 */

import { spawn } from 'child_process';
import os from 'os';

const isWindows = os.platform() === 'win32';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000; // 1MB

/**
 * OS-level variables that toolchains legitimately need in order to function.
 *
 * These are all paths/machine facts, never credentials. Apollo's own secrets
 * (OPENAI_API_KEY, JWT_SECRET, MONGO_URI, EMAIL_PASS, GROQ_API_KEY, ...) are
 * loaded from .env and are deliberately absent from this allowlist, so they are
 * never visible to user code.
 *
 * This stays a deny-by-default model — the allowlist is just wide enough that
 * interpreters and compilers actually run. Real-world need for this: on Windows,
 * `python` is often a shim (PyManager / pyenv / the Store alias) that resolves the
 * real interpreter via LOCALAPPDATA, and fails confusingly without it.
 */
const OS_ENV_ALLOWLIST = [
  'PATH', 'Path',
  'SYSTEMROOT', 'SystemRoot',
  'WINDIR', 'windir',
  'SYSTEMDRIVE', 'SystemDrive',
  'PATHEXT', 'PATHEXT',
  'COMSPEC', 'ComSpec',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMFILES', 'ProgramFiles',
  'PROGRAMFILES(X86)', 'ProgramFiles(x86)',
  'PROGRAMW6432', 'ProgramW6432',
  'PROGRAMDATA', 'ProgramData',
  'COMMONPROGRAMFILES', 'CommonProgramFiles',
  'HOMEDRIVE', 'HOMEPATH',
  'LANG', 'LC_ALL', 'TZ', 'TERM',
];

/**
 * Builds the environment handed to child processes.
 * Deny-by-default: only the allowlist above plus a few sandbox-scoped overrides.
 */
export function buildSafeEnv(cwd) {
  const env = {};

  for (const key of OS_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  // Sandbox-scoped overrides — keep caches/temp inside the throwaway dir.
  env.HOME = cwd;
  env.TEMP = cwd;
  env.TMP = cwd;
  env.LANG = env.LANG || 'en_US.UTF-8';

  // Force UTF-8 and stop Python writing __pycache__ into the project dir.
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.NODE_NO_WARNINGS = '1';

  return env;
}

/**
 * Defensive assertion used by tests: confirms no Apollo secret is present in a
 * generated environment. Kept next to the allowlist so the two can't drift.
 */
export const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY', 'GROQ_API_KEY', 'JWT_SECRET', 'MONGO_URI', 'MONGODB_URI',
  'EMAIL_USER', 'EMAIL_PASS', 'SENDER_EMAIL', 'MAIL_HOST', 'MAIL_PORT',
];

/**
 * Force-kills a child and its descendants.
 * POSIX: negative PID kills the process group (requires detached: true).
 * Windows: negative PIDs are unsupported, so use taskkill /T to walk the tree.
 */
export function killTree(child) {
  if (!child || child.pid == null) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (isWindows) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
}

/**
 * Spawns a command and resolves once it finishes.
 *
 * @param {object}   opts
 * @param {string}   opts.cmd              Executable name or absolute path.
 * @param {string[]} opts.args             Argv array. Never a shell string.
 * @param {string}   opts.cwd              Working directory (the sandbox dir).
 * @param {string}   [opts.stdin]          Data piped to the child's stdin.
 * @param {number}   [opts.timeoutMs]
 * @param {number}   [opts.maxOutputBytes]
 * @param {Function} [opts.onOutput]       ({ stream, chunk }) called as output arrives.
 * @param {Function} [opts.onSpawn]        (child) called once the child exists.
 * @param {boolean}  [opts.interactive]    When true, stdin is left OPEN so the caller
 *                                         can write to it later (live terminal input).
 *                                         The caller is responsible for ending it; the
 *                                         timeout still guards against hangs.
 *
 * @returns {Promise<{stdout,stderr,exitCode,timedOut,truncated,spawnError}>}
 */
export function spawnSafe({
  cmd,
  args = [],
  cwd,
  stdin = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  onOutput,
  onSpawn,
  interactive = false,
}) {
  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(cmd, args, {
        cwd,
        env: buildSafeEnv(cwd),
        // POSIX: new process group so we can group-kill runaway children.
        // On Windows taskkill /T handles the tree, and detached would pop a console.
        detached: !isWindows,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({
        stdout: '', stderr: `Failed to start "${cmd}": ${err.message}`,
        exitCode: -1, timedOut: false, truncated: false, spawnError: true,
      });
    }

    onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, truncated, spawnError: false });
    };

    const collect = (streamName) => (data) => {
      if (truncated) return;

      bytes += data.length;
      if (bytes > maxOutputBytes) {
        truncated = true;
        const notice = `\n\n[output truncated — exceeded ${Math.floor(maxOutputBytes / 1000)}KB limit]`;
        if (streamName === 'stdout') stdout += notice; else stderr += notice;
        onOutput?.({ stream: streamName, chunk: notice });
        killTree(child);
        return;
      }

      const text = data.toString('utf8');
      if (streamName === 'stdout') stdout += text; else stderr += text;
      onOutput?.({ stream: streamName, chunk: text });
    };

    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    // ENOENT etc. — e.g. python/g++ not installed on this host.
    child.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? `"${cmd}" was not found on the server. This language may not be available in this environment.`
        : `Process error: ${err.message}`;
      stderr += (stderr ? '\n' : '') + msg;
      finish(-1);
    });

    if (child.stdin) {
      child.stdin.on('error', () => { /* child may exit before we finish writing */ });
      try {
        if (stdin) child.stdin.write(stdin);
        // In non-interactive mode, always end stdin. Without this a program calling
        // input() blocks for the whole timeout instead of getting EOF immediately.
        // In interactive mode we deliberately leave it open for live typing.
        if (!interactive) child.stdin.end();
      } catch { /* stream already closed */ }
    }

    // 'close' (not 'exit') guarantees all stdio has been flushed.
    child.on('close', (code) => finish(code ?? -1));
  });
}

export { isWindows };

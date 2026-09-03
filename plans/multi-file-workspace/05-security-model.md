# Security model — read before Phase 2

This feature widens code execution from one file to a whole project directory. That is mostly a
change in degree, not kind — but there are two holes that exist **today** and one that this
feature would introduce if built naively. All three must be closed in Phase 2.

---

## 1. Path traversal (new risk, introduced by multi-file)

The client now sends a list of `{ path, content }`. A malicious client can send
`../../server/config/ai.js` or `C:\Windows\System32\...` and overwrite server files. The browser
UI blocking bad names (D4) is **not** a defence — anyone can POST directly to the endpoint.

**Required server-side validation, per file, reject the whole request on any failure:**

- Reject absolute paths (`path.isAbsolute`)
- Reject any path containing a `..` segment after normalisation
- Reject Windows drive prefixes (`/^[a-zA-Z]:/`) and UNC (`\\`)
- Reject null bytes (`\0`) and control characters
- Normalise separators, then the decisive check:

```js
const target = path.resolve(sessionDir, relPath);
if (target !== sessionDir && !target.startsWith(sessionDir + path.sep)) {
  throw new Error('Invalid path');
}
```

Also reject symlink creation (we only ever write regular files, so simply never call `symlink`).

## 2. Environment variable leak (**exists today, critical**)

`codeRunner.js` currently calls `execAsync` without an `env` option, so the child **inherits
`process.env`**. Any user today can run:

```python
import os; print(os.environ)
```

...and receive `OPENAI_API_KEY`, `JWT_SECRET`, `MONGO_URI` (with the DB password), and
`EMAIL_PASS` in the output panel. With `JWT_SECRET` they can forge auth tokens for any account;
with `MONGO_URI` they have direct database access.

This is the single most important fix in the whole plan, and it is cheap.

**Fix — pass an explicit minimal env, never inherit:**

```js
const safeEnv = {
  PATH: process.env.PATH,          // needed to find node/python/g++
  ...(isWindows && {
    SYSTEMROOT: process.env.SYSTEMROOT,   // Windows needs these or spawn fails
    TEMP: process.env.TEMP,
    PATHEXT: process.env.PATHEXT,
  }),
  HOME: sessionDir,                // keep tool caches inside the temp dir
};
spawn(cmd, args, { cwd: sessionDir, env: safeEnv });
```

Nothing else gets forwarded. Verify with a test that runs `print(os.environ)` and confirms no
secret keys appear.

## 3. Shell injection (exists today, fixed by design change)

Current code builds a shell string:

```js
await execAsync(`node "${tempFile}"`);        // exec => spawns a shell
```

Filenames are ours today, but in a multi-file world paths derive from user input. `exec` runs
through `cmd.exe`/`sh`, so quoting is the only thing standing between us and injection.

**Fix:** use `spawn(cmd, argsArray, opts)` everywhere. No shell is involved, arguments are
passed as an argv vector, and shell metacharacters in filenames are inert. Where a two-step
build is needed (`g++` then run the binary), run two separate `spawn` calls rather than
`&&`-chaining in a shell string.

## 4. Resource exhaustion

| Vector | Mitigation |
|---|---|
| Infinite loop | Hard timeout (10s default), `child.kill('SIGKILL')`, kill the whole process group |
| Infinite `print` loop | Cap accumulated output (e.g. 1MB); kill the child and append a truncation notice |
| Fork bomb | Not fully preventable without containers. Partial: `detached: true` + `process.kill(-pid)` to kill the group |
| Huge upload | Cap file count (100) and total bytes (1MB) before writing anything to disk |
| Many concurrent runs | One in-flight run per socket/user; kill the previous run when a new one starts |
| Disk fill | `fs.rm(dir, { recursive: true, force: true })` in a `finally`; also sweep orphaned `apollo-proj-*` dirs on server boot |

## 5. What this model does NOT protect against — stated plainly

With a scrubbed env and path validation, a user still runs a real interpreter as the server's
own OS user. They can therefore:

- Read files the server process can read, by absolute path (source code, and `server/.env`
  itself — scrubbing `process.env` does **not** stop `open('/path/to/.env')`)
- Make outbound network requests from the server's IP
- Consume CPU/RAM up to the OS limits

**The only real fix is process isolation.** Options, in order of practicality:

1. **Docker-per-run** — ephemeral container, `--network=none`, `--memory=256m`, `--pids-limit`,
   non-root user, read-only root fs with only the project dir writable. The correct answer.
   Requires Docker on the host; will not work on Render's free tier as currently deployed.
2. **Judge0** — already integrated for C++/Java. It sandboxes properly. Its constraint is
   multi-file support (needs `additional_files`) and public-instance rate limits.
3. **Run the Node process as a heavily restricted OS user** with no read access to the app
   directory. Cheap-ish, host-specific, partial.

### Deployment gate

Until at least option 1 or 2 covers the interpreted languages:

- This feature is **safe enough for local/self-hosted single-user use**.
- It is **not safe for the public Render deployment with open signups**, because of §5's
  file-read capability. The `server/.env` on that host holds live OpenAI, Mongo, and Brevo
  credentials.
- Recommended interim posture: keep multi-file execution behind a feature flag that is off in
  production, or move interpreted-language execution to Judge0 before enabling it publicly.

This is a deliberate, recorded tradeoff — not an oversight to be discovered later.

## 6. Terminal input is not a shell

The Phase 3 terminal accepts keystrokes, which invites the assumption that it's a shell. It is not.

- Typed characters are written **only** to a running child process's `stdin`.
- If no child is running, input is discarded (show a hint instead).
- There is no command parser, no `PATH` lookup of user text, no `eval`.
- The only privileged operations are the fixed `run` / `install` actions, and their command
  strings are authored entirely server-side.

Any future change that makes the terminal interpret text as commands re-opens full RCE and must
be treated as a new security review, not an increment.

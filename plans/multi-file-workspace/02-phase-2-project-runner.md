# Phase 2 — `projectRunner.js`: directory-based execution

**Goal:** run a whole project (JS + Python) from a temp directory so cross-file imports resolve,
and fix the long-broken stdin path. Still request/response — streaming comes in Phase 3.

**Depends on:** Phase 1. **Must implement `05-security-model.md` §1–4 as part of this phase.**

---

## 1. New file: `server/services/projectRunner.js`

`codeRunner.js` stays untouched initially so `/api/code/run` and the interview pages keep
working. Once Phase 3 is stable, `codeRunner.js` can delegate to `projectRunner` with a
single-file project and then be deleted.

## 2. API contract

`POST /api/code/run-project`

```jsonc
{
  "files": [
    { "path": "main.py",          "content": "from utils import add\nprint(add(2,3))" },
    { "path": "utils/helper.py",  "content": "def add(a,b): return a+b" }
  ],
  "language": "python",
  "entry":    "main.py",      // optional; auto-detected when omitted
  "stdin":    "",
  "action":   "run"           // "run" | "install"
}
```

Response:

```jsonc
{ "stdout": "5\n", "stderr": "", "exitCode": 0, "timedOut": false, "truncated": false }
```

Errors → `400` for validation failures (bad path, too many files, unsupported language),
`500` for genuine server faults. Validation messages must not echo the offending path back
verbatim into logs without escaping.

## 3. Execution sequence

1. **Validate** — file count ≤ 100, total bytes ≤ 1MB, language supported, every path passes
   §1 traversal checks. Reject the entire request on any failure; write nothing.
2. **Create dir** — `await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-proj-'))`.
   `mkdtemp` (not a `Date.now()` name) avoids collisions and races.
3. **Write files** — `fs.mkdir(dirname, { recursive: true })` then `fs.writeFile`, after the
   `path.resolve` containment assert per file.
4. **Resolve entry point** — see §4.
5. **Build command** — fixed template per language, argv array (§5).
6. **Spawn**, feed stdin, collect output with the byte cap, enforce the timeout.
7. **Cleanup** — `fs.rm(dir, { recursive: true, force: true })` in `finally`, unconditionally.

## 4. Entry-point detection

Used when `entry` is omitted. First match wins; the resolved entry is echoed back so the UI can
show what actually ran.

| Language | Order |
|---|---|
| javascript | `main.js` → `index.js` → `package.json`'s `main` field → first root-level `.js` |
| python | `main.py` → `app.py` → first root-level `.py` |
| java | file whose content matches `public static void main` |
| cpp | file whose content matches `int main(` |

If nothing matches, return a `400` with a clear message ("No entry point found — create
`main.py` or pick one explicitly") rather than a cryptic runtime error.

## 5. Command templates (argv arrays, no shell)

```js
// javascript
{ cmd: 'node',   args: [entryRelPath] }

// python  — 'python' on Windows, 'python3' elsewhere; probe once at boot
{ cmd: pythonCmd, args: ['-u', entryRelPath] }   // -u = unbuffered, critical for Phase 3 streaming
```

`-u` matters: without it CPython block-buffers stdout when not attached to a TTY, so Phase 3's
"live" terminal would deliver everything in one lump at exit. Set it now.

Node is line-buffered to pipes and needs no equivalent flag.

C++/Java are Phase 4 — see `04-phase-4-cpp-java.md`.

## 6. stdin — fixes defect D5

```js
const child = spawn(cmd, args, { cwd: sessionDir, env: safeEnv, detached: true });
if (stdin) child.stdin.write(stdin);
child.stdin.end();          // always end, or programs waiting on input hang until timeout
```

`child.stdin.end()` must run even when `stdin` is empty, otherwise a Python script calling
`input()` blocks for the full timeout instead of getting EOF immediately.

Wire `stdin` through `codeController.js` too — it currently destructures only
`{ code, language }` and silently drops it.

## 7. `install` action — gated

`npm install` / `pip install -r requirements.txt` are attractive but each opens real problems:
arbitrary package download (network egress + supply-chain risk), multi-minute runtimes, and
hundreds of MB of disk per run. They also fully negate the "cheap temp dir" model.

**Decision: do not ship `install` in Phase 2.** Keep the `action` field in the contract so the
shape is stable, and return `501 Not Implemented` for `install`. Revisit only once container
isolation (§5 option 1) exists, since that's what makes dependency installs affordable and safe.

Projects in phases 2–4 are therefore **stdlib-only**. This is a real limitation to surface in
the UI ("third-party packages aren't supported yet"), not to leave users to discover.

## 8. Timeout and output caps

```js
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1_000_000;
```

- On timeout: `process.kill(-child.pid, 'SIGKILL')` (negative pid kills the group, which
  `detached: true` enables) and return `timedOut: true` with whatever output accumulated.
- On exceeding the output cap: kill the same way, set `truncated: true`, append a notice.
- Both must still return the partial output — a runaway loop's first lines are often the clue
  the user needs.

## 9. Files touched

| File | Change |
|---|---|
| `server/services/projectRunner.js` | **Create** |
| `server/controllers/codeController.js` | Add `runProject`; fix `stdin` pass-through on `runCode` |
| `server/routes/codeRoutes.js` | `POST /run-project` |
| `server/services/codeRunner.js` | Add the `safeEnv` fix from §2 of the security doc (do this even before the rest lands — it's the critical leak) |
| `client/src/services/api.js` | Add `runProject({ files, language, entry, stdin })` |
| `client/src/pages/Workspace.jsx` | `handleRun` serialises the tree via `getNodePath` and calls `runProject` |
| `client/src/utils/fileSystem.js` | Add `flattenToFileList(nodes, rootId)` → `[{ path, content }]`, excluding folders, paths relative to root |

No new npm dependencies in this phase.

## 10. Manual verification

- [ ] Two-file Python project where `main.py` imports from `utils/helper.py` → runs, prints correctly
- [ ] Two-file Node project using `require('./helper')` → runs correctly
- [ ] Python `input()` with stdin supplied in the panel → receives the value (D5 fixed)
- [ ] Python `input()` with **empty** stdin → gets EOF immediately, does not hang 10s
- [ ] `while True: pass` → killed at ~10s, `timedOut: true`, UI shows a timeout message
- [ ] `while True: print('x')` → killed on the output cap, partial output shown, `truncated: true`
- [ ] **`import os; print(os.environ)` → no `OPENAI_API_KEY`, `JWT_SECRET`, `MONGO_URI`, or `EMAIL_PASS` present**
- [ ] POST a crafted path `../../server/server.js` → `400`, and `server/server.js` is unmodified
- [ ] POST an absolute path → `400`
- [ ] POST 200 files → `400` before anything is written to disk
- [ ] Syntax error in a Python file → stderr with a usable traceback and correct filename
- [ ] `os.tmpdir()` has no leftover `apollo-proj-*` dirs after a run, including after a timeout
- [ ] Existing single-file `/api/code/run` still works (interview pages, test generator)
- [ ] AI test generator still passes/fails correctly (it posts `fullExecutableCode` to `/run`)

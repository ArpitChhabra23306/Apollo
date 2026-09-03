# Phase 4 — Multi-file C++ and Java

**Goal:** compile and run multi-file C++ and Java projects, with a graceful fallback when the
host has no toolchain.

**Depends on:** Phase 3 (uses the same streaming pipeline).

---

## 1. The core difference from JS/Python

JS and Python are interpreted — one `spawn` and you're done. C++ and Java need a **two-step
build**: compile all sources, then execute the artifact. Each step needs its own `spawn`, and
compiler errors must be reported distinctly from runtime errors (a compile failure means there is
nothing to run).

Do **not** chain with `&&` in a shell string — that reintroduces the shell we removed in
security §3. Run step 1, check the exit code, then conditionally run step 2.

## 2. C++

```js
// Step 1 — compile every .cpp in the project
{ cmd: 'g++', args: ['-std=c++17', '-O0', ...allCppFiles, '-o', binName] }
// Step 2 — run the artifact
{ cmd: path.join(sessionDir, binName), args: [] }
```

- `binName` = `app.exe` on Windows, `app` elsewhere.
- Pass every `.cpp` file; headers (`.h`/`.hpp`) are picked up via `#include "..."` relative to
  the source dir, so they need no explicit flag.
- Compile step gets its own, longer timeout (~20s) — g++ on several files is slower than a script.
- Compiler diagnostics arrive on stderr. Emit them as `project:output` with `stream: 'stderr'`
  so they appear in the terminal, then send `project:exit` with the compiler's exit code and skip
  step 2.
- Step 2 inherits the same `safeEnv`, timeout, and output cap as every other language.

## 3. Java

```js
// Step 1
{ cmd: 'javac', args: ['-d', sessionDir, ...allJavaFiles] }
// Step 2
{ cmd: 'java',  args: ['-cp', sessionDir, mainClassName] }
```

`mainClassName` needs real derivation, not a guess:

1. Find the file containing `public static void main`.
2. If it declares `package a.b;`, the class name is `a.b.ClassName`.
3. `ClassName` must match the filename (Java enforces this for public classes) — if it doesn't,
   fail fast with a clear message rather than letting `java` emit a confusing
   `ClassNotFoundException`.

`javac` writes `.class` files into the temp dir, which the existing recursive cleanup already
removes.

## 4. Toolchain detection

Probe **once at server boot** and cache — don't probe per run.

```js
// server/services/toolchain.js
export const available = { gpp: bool, javac: bool, python: bool };
```

Probe by spawning `g++ --version` / `javac -version` / `python --version` and checking for a
clean exit. Log the result at startup so a misconfigured host is obvious immediately:

```
[toolchain] node ✓  python ✓  g++ ✗  javac ✗
```

Expose it via the existing `/health` endpoint so the frontend can disable or annotate languages
whose toolchain is missing, instead of letting users hit a confusing failure.

## 5. Fallback when no local toolchain

`codeRunner.js` already falls back to Judge0 CE for C++/Java using `server/config/languages.js`.
Reuse it, with an honest limitation:

- **Judge0 CE's basic submission takes a single `source_code` string.** Multi-file C++/Java is not
  possible through that path.
- So: if `g++`/`javac` is missing **and** the project has one source file → send it to Judge0.
- If missing **and** the project has multiple files → return a clear error: "Multi-file C++
  requires a local compiler on the server; only single-file execution is available here."

Do not silently concatenate multiple files into one string. That produces incomprehensible
compiler errors and is worse than an honest refusal.

**Stretch (not in scope):** Judge0 supports multi-file via an `additional_files` base64 zip on
`/submissions`. That would restore multi-file support on toolchain-less hosts and is the right
follow-up, but it needs its own request-shaping work and is not part of this phase.

Also note Judge0 is request/response with polling, so it cannot stream. Surface it in the
terminal as a single "compiling remotely…" block followed by the complete result, and don't
pretend it's live.

## 6. Deployment reality check

Render's free tier does not ship `g++` or a JDK. So in production today, C++/Java land on the
Judge0 fallback and are therefore single-file only. Locally (this Windows dev machine), it depends
on whether MinGW/MSVC and a JDK are installed — the boot probe will say.

This asymmetry needs to be visible in the UI rather than being a mystery: show which languages
support multi-file in the current environment.

## 7. Files touched

| File | Change |
|---|---|
| `server/services/toolchain.js` | **Create** — boot-time probe + cache |
| `server/services/projectRunner.js` | Two-step build support, per-language branching |
| `server/server.js` | Run the probe at boot, log results |
| `server/services/codeRunner.js` | Reuse/extract the Judge0 submit+poll helper |
| `client/src/pages/Workspace.jsx` | Read toolchain info from `/health`, annotate languages |

## 8. Manual verification

- [ ] Multi-file C++ (`main.cpp` + `math.cpp` + `math.h`) compiles and runs
- [ ] C++ compile error → diagnostics with correct filename and line, run step skipped
- [ ] C++ runtime crash (segfault) → non-zero exit reported, not shown as a compile failure
- [ ] C++ reading `cin` via terminal stdin works
- [ ] Multi-file Java (two classes, one with `main`) compiles and runs
- [ ] Java with a `package` declaration → correct fully-qualified class is invoked
- [ ] Java class name / filename mismatch → clear, early error message
- [ ] Boot log prints an accurate toolchain table
- [ ] With `g++` unavailable: single-file C++ routes to Judge0 and succeeds
- [ ] With `g++` unavailable: multi-file C++ returns the explicit "requires a local compiler" error
- [ ] Compile timeout (a pathological template) is killed and reported
- [ ] No `.class` files, binaries, or temp dirs left behind after any of the above

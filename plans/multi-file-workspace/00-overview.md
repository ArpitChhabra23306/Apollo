# Apollo — Multi-File VS Code Workspace (Option 4)

> **Status:** planning only. No implementation started beyond a partial frontend scaffold.
> **Scope:** roadmap feature #1 (VS Code Multi-File Tree & Tabs) + real project execution.
> These are scratch planning docs. Delete or gitignore once the feature ships.

---

## 1. Goal

Turn Apollo's single-file editor into a multi-file project workspace with a VS Code feel:

- File/folder explorer with create, rename, delete, nesting
- Multiple open Monaco tabs
- Real multi-file projects for **JavaScript, Python, C++, Java** where cross-file imports actually resolve
- A terminal panel showing **live streaming** stdout/stderr, with interactive stdin

## 2. Chosen approach: server-side sandboxed execution

Execution stays on Apollo's backend. The virtual file tree is written to a per-run temp
directory, then a **fixed, server-authored command** runs inside it.

Rejected alternatives (recorded so we don't relitigate):

| Option | Why not |
|---|---|
| Local companion agent | Requires every user to download + run a binary. Kills zero-install adoption; needs cross-OS signing. |
| Electron / Tauri desktop app | Most literal "be VS Code," but forks the product into web vs desktop. Multi-week packaging effort. |
| File System Access API alone | Gives real folder open/save, but no execution. Doesn't satisfy "run things." |
| Raw PTY shell (`node-pty`) | Full RCE on our server. Only viable behind Docker isolation. Deferred — see `05-security-model.md`. |

**Why this one works:** the requirement is a file tree, multi-file projects, and visible run
output. None of that needs the user's physical PC. The backend already executes untrusted
`node`/`python` for single files. This widens an accepted capability from *one file* to *one
directory* — it is not a new class of risk, though it does need hardening we don't currently have.

## 3. What already exists (verified, not assumed)

| Asset | State |
|---|---|
| `client/src/utils/fileSystem.js` | Written. Virtual FS tree + CRUD + localStorage. Untested. |
| `client/src/components/FileExplorer/FileExplorer.jsx` | Written. **Has 2 defects + a missing CSS import.** See `06-known-defects.md`. |
| `client/src/components/FileExplorer/FileExplorer.css` | **Missing.** Imported but never created — build breaks. |
| `EditorTabs`, `Terminal` components | Do not exist. |
| `client/src/pages/Workspace.jsx` | Still single-file (`code` / `language` useState). Untouched. |
| `server/services/codeRunner.js` | Single-file only. Uses `exec` with string interpolation. **Ignores stdin.** |
| `server/sockets/interviewSockets.js` | Socket.io already wired and working — reuse this pattern. |
| `server/config/languages.js` | Judge0 language ID map, ready for the C++/Java fallback. |

## 4. Phase order

Each phase is independently shippable and leaves the app working.

| Phase | Doc | Deliverable | Est. |
|---|---|---|---|
| 0 | `06-known-defects.md` | Fix scaffold defects so it compiles | ~1h |
| 1 | `01-phase-1-file-tree-tabs.md` | Explorer + tabs + multi-file state in Workspace | ~0.5d |
| 2 | `02-phase-2-project-runner.md` | `projectRunner.js` — directory execution, JS + Python, stdin fixed | ~0.5d |
| 3 | `03-phase-3-streaming-terminal.md` | xterm.js panel, live streaming over Socket.io, interactive stdin | ~1d |
| 4 | `04-phase-4-cpp-java.md` | Multi-file C++/Java compile, Judge0 fallback | ~0.5d |

Cross-cutting: `05-security-model.md` — **read before Phase 2.** It contains a secret-leak
issue that must be fixed as part of Phase 2, not after.

Total: ~2.5–3 focused days.

## 5. Decisions locked in

1. **`spawn` with an argv array, never `exec` with an interpolated string.** No shell, so
   filenames and paths cannot inject commands. This is a security upgrade over today's runner.
2. **The terminal never evaluates free text.** Typed input is forwarded only to a running
   child process's stdin. There is no command interpreter. Users cannot type `ls` or `cat`.
3. **Persistence stays in `localStorage`** for now, matching the existing theme pattern. No
   `Project` Mongoose model yet — that's a separate change, best folded in with the unbuilt
   "Saved Snippets" feature.
4. **Language is derived from the active file's extension**, not the topbar dropdown.
5. **Child processes get a scrubbed environment**, not `process.env`. Non-negotiable — see
   `05-security-model.md` §2.

## 6. Explicit non-goals for this feature

- Real shell access
- Docker/container isolation (documented as the eventual answer, not built here)
- Server-side project persistence or sharing
- npm/pip installs of arbitrary packages *in phase 1–4* (see `02` §7 for why this is gated)
- Git integration, debugging/breakpoints, extensions, IntelliSense beyond Monaco's built-in

## 7. Verification approach

The project has no test framework. Each phase doc ends with a **manual verification matrix**
that must pass before moving on. Adding `vitest` to unit-test `fileSystem.js`'s pure
functions is worthwhile but optional, and is not assumed by this plan.

# Phase 3 — Streaming terminal panel (xterm.js + Socket.io)

**Goal:** replace the buffered output panel with a real terminal that streams stdout/stderr as
it is produced, and supports interactive stdin (so Python `input()` prompts work live).

**Depends on:** Phase 2.

---

## 1. Why sockets and not SSE

The AI features use SSE, which is one-directional (server → client). Interactive stdin needs
client → server mid-run, so SSE can't carry it without a second channel. Socket.io is already a
dependency and already initialised in `server.js` for the interview rooms, so this reuses proven
infrastructure rather than adding any.

## 2. New dependencies (pin exact versions)

```
client: @xterm/xterm  @xterm/addon-fit
```

Note the scoped `@xterm/*` names — the old unscoped `xterm` package is deprecated. No new
server dependencies.

## 3. Socket protocol

New file `server/sockets/terminalSockets.js`, mirroring `interviewSockets.js`'s structure, and
initialised alongside it in `server.js`.

**Client → server**

| Event | Payload | Notes |
|---|---|---|
| `project:run` | `{ files, language, entry, action }` | Validated exactly as the HTTP route in Phase 2 — same shared validator, no duplicated logic |
| `project:stdin` | `{ data: string }` | Forwarded verbatim to the running child's stdin. **Never interpreted.** Ignored if no child is running |
| `project:kill` | — | User-initiated stop |

**Server → client**

| Event | Payload |
|---|---|
| `project:started` | `{ entry, command }` — so the terminal can echo a `$ node main.js` style banner |
| `project:output` | `{ stream: 'stdout'\|'stderr', chunk: string }` |
| `project:exit` | `{ exitCode, timedOut, truncated }` |
| `project:error` | `{ message }` — validation/spawn failures |

## 4. Server-side session management

Keep a `Map<socketId, { child, sessionDir }>`.

- On `project:run`: if an entry already exists for that socket, kill it and clean its dir first.
  **One concurrent run per socket** — this is the concurrency cap from the security doc §4.
- Stream by attaching to `child.stdout`/`child.stderr` `'data'` events and emitting each chunk
  immediately. Do not accumulate-then-send.
- Keep enforcing the timeout and the 1MB output cap from Phase 2; the cap now counts bytes
  emitted so far per run.
- **On `disconnect`: kill the child (process group) and remove the temp dir.** Without this,
  closing the browser tab mid-run orphans processes and leaks directories — the most likely
  source of a slow server death.
- On server boot, sweep leftover `apollo-proj-*` dirs from `os.tmpdir()` (crash recovery).

## 5. Refactor `projectRunner.js` for both callers

Phase 2 returns a buffered result; Phase 3 needs incremental callbacks. Restructure into one core
plus two thin wrappers so validation/entry-detection/cleanup exist in exactly one place:

```js
// core — emits as it goes
export async function runProjectStreaming({ files, language, entry, action }, handlers)
// handlers = { onStart, onOutput, onExit, onError }

// wrapper used by the HTTP route — buffers into a single response
export async function runProject(opts)
```

The HTTP endpoint from Phase 2 stays available (useful for the AI test generator, which wants
one JSON result, not a stream).

## 6. New component — `Terminal`

`client/src/components/Terminal/Terminal.jsx` + `.css`

- Instantiate `Terminal` from `@xterm/xterm` in a `useEffect`, `FitAddon` for resize, dispose on
  unmount (xterm leaks DOM/listeners if not disposed).
- Theme it from the existing CSS custom properties so light/dark keeps working. xterm needs
  concrete colour values, so read them via `getComputedStyle` on `documentElement` and re-apply
  when `darkMode` flips.
- `term.onData(data => socket.emit('project:stdin', { data }))` — plus local echo, since the
  child won't echo typed characters back.
- Render stderr in red using an ANSI wrap (`\x1b[31m…\x1b[0m`) rather than a separate pane, so
  interleaved ordering is preserved.
- Call `fitAddon.fit()` on container resize (a `ResizeObserver`), because the bottom drawer is
  resizable.

**UX guard:** if the user types while nothing is running, print a dim hint like
`(no process running — press Run to start)`. This makes the "not a shell" boundary from
security §6 legible rather than feeling broken.

## 7. Bottom drawer integration

`OutputPanel` currently owns the stdin textarea and the output display. Replace its body with a
tabbed drawer:

- **Terminal** tab → the new xterm panel (default)
- **Testcases / Test Result** tabs → the existing test console, moved here from its current
  inline position under the editor

The standalone stdin `<textarea>` becomes redundant once input is typed directly into the
terminal. Keep it available for the single-file `/api/code/run` path used by the test generator,
or retire it — decide during implementation, but do not leave two competing stdin inputs visible
at once.

The drawer needs a vertical resize handle (the existing handles are horizontal/`col-resize`
only); add a `row-resize` variant.

## 8. Files touched

| File | Change |
|---|---|
| `server/sockets/terminalSockets.js` | **Create** |
| `server/server.js` | `initTerminalSockets(io)` next to `initInterviewSockets(io)` |
| `server/services/projectRunner.js` | Split into streaming core + buffered wrapper |
| `client/src/components/Terminal/Terminal.jsx` / `.css` | **Create** |
| `client/src/components/OutputPanel/OutputPanel.jsx` / `.css` | Convert to tabbed drawer |
| `client/src/pages/Workspace.jsx` | Socket lifecycle, `handleRun` emits `project:run`, drawer resize |
| `client/package.json` | `@xterm/xterm`, `@xterm/addon-fit` pinned |

## 9. CORS note

`server.js` sets Socket.io `cors.origin: '*'` with a `// Adjust this in production` comment. That
is already loose for the interview sockets; this phase adds code execution to the same server, so
a wildcard origin now means any website can open a socket and trigger runs. Tighten to an
explicit allowlist (localhost dev origin + the Vercel/Render production origin) as part of this
phase.

## 10. Manual verification

- [ ] Run a Python script printing 1..50 with a `time.sleep(0.1)` → lines appear progressively, not all at once
- [ ] Same for Node with `setInterval`
- [ ] Python `input()` → prompt appears, typing in the terminal is echoed, the program receives it and continues
- [ ] stderr text renders red and stays correctly interleaved with stdout
- [ ] `project:kill` / Stop button terminates a running infinite loop immediately
- [ ] Starting a second run while one is active kills the first (no doubled output)
- [ ] Close the browser tab mid-run → server logs the child being killed; no orphaned `node`/`python` process remains; temp dir removed
- [ ] Typing with nothing running shows the hint and does not execute anything
- [ ] Resize the drawer → terminal reflows, no clipped columns
- [ ] Toggle dark/light → terminal colours update
- [ ] Unmount/remount (navigate away and back) → no duplicate xterm instances, no listener leak warnings
- [ ] Interview pages' sockets still work (regression: shared `io` server)
- [ ] Test generator still gets its buffered JSON result from the HTTP route

# Phase 0 — Fix existing scaffold defects

Must be done first. The frontend scaffold currently does not compile.

---

## D1 — Missing `FileExplorer.css` (build breaker)

`FileExplorer.jsx` line 3 has `import './FileExplorer.css';` but the file was never created.
Vite will fail to resolve it.

**Fix:** create `client/src/components/FileExplorer/FileExplorer.css`. Must theme off the
existing tokens in `App.css` (`--ws-bg`, `--ws-panel`, `--ws-border`, `--ws-purple`,
`--ws-text-secondary`, etc.) so light/dark mode keeps working automatically.

Classes the JSX already references and that the CSS must define:

```
.fe-root            .fe-header          .fe-header-actions
.fe-tree            .fe-empty           .fe-node-wrapper
.fe-node            .fe-node.active     .fe-node-name
.fe-chevron         .fe-chevron.expanded
.fe-children        .fe-rename-input
.fe-menu-backdrop   .fe-context-menu    .fe-menu-divider
.fe-menu-danger
```

Notes:
- `.fe-context-menu` needs `position: fixed` (it's positioned from `e.clientX/clientY`) and a
  high `z-index` so it escapes the sidebar's `overflow`.
- `.fe-menu-backdrop` must be a full-viewport fixed layer beneath the menu to catch outside clicks.
- `.fe-chevron` rotates 90deg when `.expanded`.

## D2 — React hooks rule violation in `TreeNode` (runtime bug)

`FileExplorer.jsx` currently does:

```js
function TreeNode({ id, nodes, ... }) {
  const node = nodes[id];
  if (!node) return null;          // <-- early return

  const [contextMenu, setContextMenu] = useState(null);   // <-- hooks AFTER a conditional return
  const [renameValue, setRenameValue] = useState(node.name);
```

Calling hooks after a conditional return breaks the rules of hooks. When a node is deleted,
the hook call order changes between renders and React will throw. `eslint-plugin-react-hooks`
is already configured in this repo and will flag it.

**Fix:** hoist both `useState` calls above the `if (!node) return null;` guard, and make
`renameValue` tolerate `node` being undefined:

```js
const node = nodes[id];
const [contextMenu, setContextMenu] = useState(null);
const [renameValue, setRenameValue] = useState(node?.name ?? '');
if (!node) return null;
```

## D3 — `renameValue` goes stale after a rename

`useState(node.name)` only seeds on mount. Rename a file, then open rename again — the input
shows the old name.

**Fix:** when `onRequestRename(id)` fires, reset the value. Simplest reliable approach is to
seed the input from the node at the moment renaming begins, e.g. sync in the rename handler in
the parent, or add:

```js
useEffect(() => {
  if (isRenaming) setRenameValue(node.name);
}, [isRenaming, node.name]);
```

## D4 — Duplicate-name collisions are unhandled

`createNode` and `renameNode` in `fileSystem.js` allow two children of the same folder to share
a name. Phase 2 writes these to a real directory, where the second write silently overwrites
the first — data loss.

**Fix (in `fileSystem.js`, before Phase 2):**
- Add `hasSiblingWithName(nodes, parentId, name, excludeId)`.
- On create: auto-suffix (`new-file.js`, `new-file-1.js`, ...).
- On rename: reject and keep the input open, surfacing an inline error.
- Also reject names containing `/`, `\`, `:`, `..`, or leading/trailing whitespace, and reject
  empty names. Path safety is enforced server-side too (see `05-security-model.md` §1), but
  blocking it at the source gives a better UX.

## D5 — `stdin` is silently dropped by the backend (pre-existing bug)

Not caused by the scaffold, but it lands in the middle of this feature's blast radius.

- `OutputPanel.jsx` collects stdin and `Workspace.jsx` holds it in state.
- `api.js` `runCode()` sends `stdin` in the POST body.
- `codeController.js` destructures only `{ code, language }` — **`stdin` is discarded.**
- `codeRunner.js` `executeCode(code, language)` has no stdin parameter at all.

So the stdin box in the UI has never done anything. Any project with `input()` or `cin` hangs
or reads EOF.

**Fix:** handled properly in Phase 2 (`02-phase-2-project-runner.md` §5) by writing to the
child's `stdin` stream. Recording it here so it isn't mistaken for a regression introduced by
this feature.

---

## Phase 0 verification

- [ ] `npm run dev` in `client/` starts with no unresolved-import error
- [ ] `npm run lint` in `client/` reports no `react-hooks/rules-of-hooks` error
- [ ] Explorer renders the default project, folder expand/collapse works
- [ ] Right-click a folder → New File / New Folder / Rename / Delete all work
- [ ] Rename a file twice in a row — the input shows the *current* name both times
- [ ] Creating two files with the same default name produces `new-file.js` and `new-file-1.js`
- [ ] Deleting a folder removes its descendants and does not crash
- [ ] Root node cannot be deleted or renamed

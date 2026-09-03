# Phase 1 — File tree + editor tabs (frontend only)

**Goal:** replace `Workspace.jsx`'s single `code` string with a real project model, add the
Explorer to the sidebar and a tab strip above Monaco. Zero backend changes, zero new risk.

**Depends on:** Phase 0 complete.

---

## 1. State model change

`Workspace.jsx` today:

```js
const [code, setCode] = useState('// Type or paste your code here...\n');
const [language, setLanguage] = useState('javascript');
```

Becomes:

```js
const [project, setProject] = useState(loadProject);   // from utils/fileSystem.js
// project = { rootId, nodes, openTabs: string[], activeFileId: string|null }
```

Then **derive** the values the rest of the page already consumes, so existing AI/run code
paths keep working with minimal churn:

```js
const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
const code       = activeFile?.content  ?? '';
const language   = activeFile?.language ?? 'javascript';
```

This is the key insight that keeps the diff small: every existing call site
(`handleAskAI`, `handleSendMessage`, `handleRun`, `handleGenerateTests`) references `code` and
`language`, and continues to work untouched.

`setCode` is replaced by:

```js
const updateActiveFileContent = (content) => {
  setProject(p => ({ ...p, nodes: updateFileContent(p.nodes, p.activeFileId, content) }));
};
```

## 2. Handlers to add in `Workspace.jsx`

| Handler | Behaviour |
|---|---|
| `handleSelectFile(id)` | Set `activeFileId`; append to `openTabs` if absent |
| `handleCloseTab(id)` | Remove from `openTabs`; if it was active, activate the neighbouring tab (prefer the one to the left), else `null` |
| `handleCreateNode(parentId, name, type)` | `createNode(...)`; if a file, auto-open it as the active tab |
| `handleRenameNode(id, newName)` | `renameNode(...)` — note this also re-derives `language` from the new extension |
| `handleDeleteNode(id)` | `deleteNode(...)`; close any tabs among the returned `deletedIds`; reassign `activeFileId` if it was deleted |

## 3. Persistence

Debounce, don't write on every keystroke:

```js
useEffect(() => {
  const t = setTimeout(() => saveProject(project), 300);
  return () => clearTimeout(t);
}, [project]);
```

`localStorage` is synchronous and blocks the main thread; a 300ms debounce keeps typing smooth.

## 4. New component — `EditorTabs`

`client/src/components/EditorTabs/EditorTabs.jsx` + `.css`

Props: `{ openTabs, nodes, activeFileId, onSelect, onClose }`

- Horizontal strip above the Monaco wrapper, horizontally scrollable, no wrap
- Per tab: file-type icon, filename, `×` close button (close must `stopPropagation`)
- Active tab: purple top-border accent + `--ws-panel` background, matching VS Code
- Middle-click closes a tab
- Empty state (no open tabs): show a centered "No file open — pick one from the Explorer" panel
  instead of Monaco

**No dirty-state indicator.** Because edits auto-persist to `localStorage` continuously there is
no "unsaved" concept to represent. Revisit only if server-side save lands later.

## 5. Monaco per-file models

Currently `CodeEditor.jsx` takes `language`/`value` and is remounted implicitly. To get real
per-file undo history and cursor/scroll restoration, pass Monaco a `path`:

```jsx
<Editor
  path={activeFilePath}        // e.g. "project/src/main.py" — must be unique per file
  language={language}
  value={code}
  onChange={handleChange}
  ...
/>
```

`@monaco-editor/react` creates a separate model per `path` and (with its default
`saveViewState`) restores scroll position and selection when you switch back. Without `path`,
switching tabs shares one model and undo history bleeds across files.

Requires a helper in `fileSystem.js`:

```js
export function getNodePath(nodes, id)  // walks parentId chain -> "project/src/main.py"
```

This same function is reused in Phase 2 to build the relative paths sent to the server, so
build it here and export it.

`CodeEditor.jsx` needs a new optional `path` prop threaded through to `<Editor>`. Keep it
optional so `Interview.jsx` and `FormalInterview.jsx`, which both render `CodeEditor` without a
path, are unaffected.

## 6. Sidebar layout — Activity Bar

The sidebar already holds WORKSPACES / IMMERSIVE / CODE ANALYSIS. Adding a file tree on top of
that overflows it. Add a VS Code–style vertical activity bar (~48px) on the far left:

- **Files** icon (`LucideIcons.Files`) → sidebar shows `<FileExplorer />`
- **AI Modes** icon (`LucideIcons.Sparkles`) → sidebar shows the current mode/nav sections

State: `const [activityView, setActivityView] = useState('files');`

The existing `sidebarWidth` drag handle and its clamp (160–400px) stay as-is and now resize
whichever view is showing.

## 7. Language selector

The topbar `<select>` currently drives `language` manually. Now that language is derived from
the file extension, that dropdown would conflict with the active file.

**Decision:** remove the manual `<select>` and replace it with a read-only badge showing the
active file's detected language. Creating `main.py` makes the project Python; there's no
separate control to get out of sync. A per-project *run target* (entry point) is introduced in
Phase 2 and is a different concept from syntax language.

## 8. Files touched

| File | Change |
|---|---|
| `client/src/utils/fileSystem.js` | Add `getNodePath`, `hasSiblingWithName` (D4) |
| `client/src/components/FileExplorer/FileExplorer.css` | **Create** (D1) |
| `client/src/components/FileExplorer/FileExplorer.jsx` | Fix D2/D3 |
| `client/src/components/EditorTabs/EditorTabs.jsx` | **Create** |
| `client/src/components/EditorTabs/EditorTabs.css` | **Create** |
| `client/src/components/CodeEditor/CodeEditor.jsx` | Add optional `path` prop |
| `client/src/pages/Workspace.jsx` | State model, handlers, activity bar, tabs, remove lang select |
| `client/src/App.css` | Activity bar styles |

No new npm dependencies in this phase.

## 9. Manual verification

- [ ] Create nested folders and files; tree renders correct indentation
- [ ] Open 3+ files; tabs appear; clicking a tab switches editor content
- [ ] Type in file A, switch to B, switch back — A's content is intact
- [ ] Undo (Ctrl+Z) in file A does **not** undo edits made in file B
- [ ] Scroll position is restored when returning to a tab
- [ ] Close active tab → a neighbouring tab activates, editor doesn't blank out
- [ ] Close all tabs → empty-state panel shows, no crash
- [ ] Rename `main.js` → `main.py`; language badge flips to Python, syntax highlighting changes
- [ ] Delete a folder containing open files → those tabs close automatically
- [ ] Reload the page → tree, open tabs, and active file all restore
- [ ] Toggle dark/light → Explorer and tabs both theme correctly
- [ ] Existing AI modes (Explain / Review / Roast) still run against the active file
- [ ] `Run Code` still works on the active file (still single-file until Phase 2)
- [ ] Interview pages still render their editors correctly (regression check on `CodeEditor`)

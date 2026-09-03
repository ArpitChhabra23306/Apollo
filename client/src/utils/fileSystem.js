/**
 * Apollo — Virtual File System
 *
 * A lightweight in-browser file/folder tree for multi-file projects.
 * Persisted to localStorage (there is no backend Project model yet).
 *
 * Shape:
 *   project = { rootId, nodes, openTabs: string[], activeFileId: string|null }
 *   folder  = { id, name, type: 'folder', parentId, children: string[] }
 *   file    = { id, name, type: 'file',   parentId, content, language }
 */

const STORAGE_KEY = 'apollo-project-v1';

const EXT_LANGUAGE_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  c: 'cpp',
  json: 'json',
  md: 'markdown',
  txt: 'plaintext',
  css: 'css',
  html: 'html',
};

/** Languages Apollo can actually execute. */
export const RUNNABLE_LANGUAGES = ['javascript', 'python', 'cpp', 'java'];

export function getLanguageFromFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_LANGUAGE_MAP[ext] || 'plaintext';
}

export function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ═══════════════════════════════════════
   Name validation (defect D4)
   Paths are re-validated server-side too, but blocking bad names at the
   source gives a far better error experience.
   ═══════════════════════════════════════ */

// CON, PRN, AUX, NUL, COM1-9, LPT1-9 are unusable filenames on Windows.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function validateNodeName(name) {
  const trimmed = (name || '').trim();

  if (!trimmed) return { ok: false, error: 'Name cannot be empty' };
  if (trimmed.length > 255) return { ok: false, error: 'Name is too long' };
  if (trimmed === '.' || trimmed === '..') return { ok: false, error: 'Invalid name' };
  if (/^\.[a-zA-Z0-9]+$/.test(trimmed) && trimmed !== '.gitignore' && trimmed !== '.env') {
    return { ok: false, error: 'Please enter a filename before the extension (e.g. app.js)' };
  }
  if (/[/\\]/.test(trimmed)) return { ok: false, error: 'Name cannot contain / or \\' };
  if (trimmed.includes(':')) return { ok: false, error: 'Name cannot contain :' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>"|?*]/.test(trimmed)) return { ok: false, error: 'Name contains invalid characters' };
  if (trimmed.endsWith('.')) return { ok: false, error: 'Name cannot end with a period' };
  if (WINDOWS_RESERVED.test(trimmed)) return { ok: false, error: `"${trimmed}" is a reserved name` };

  return { ok: true, name: trimmed };
}

export function hasSiblingWithName(nodes, parentId, name, excludeId = null) {
  const parent = nodes[parentId];
  if (!parent?.children) return false;
  const lower = name.toLowerCase(); // case-insensitive: matches Windows/macOS behaviour
  return parent.children.some(
    (cid) => cid !== excludeId && nodes[cid]?.name.toLowerCase() === lower
  );
}

/**
 * Returns `desired`, or `desired-1`, `desired-2`, ... until it is unique
 * among the parent's children. Extension is preserved.
 */
export function uniqueName(nodes, parentId, desired) {
  if (!hasSiblingWithName(nodes, parentId, desired)) return desired;

  const dot = desired.lastIndexOf('.');
  const hasExt = dot > 0;
  const base = hasExt ? desired.slice(0, dot) : desired;
  const ext = hasExt ? desired.slice(dot) : '';

  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!hasSiblingWithName(nodes, parentId, candidate)) return candidate;
  }
  return `${base}-${genId().slice(0, 6)}${ext}`;
}

/* ═══════════════════════════════════════
   Project lifecycle
   ═══════════════════════════════════════ */

/** Default starter project: a root folder containing main.js. */
export function createDefaultProject() {
  const rootId = 'root';
  const fileId = genId();
  const nodes = {
    [rootId]: { id: rootId, name: 'project', type: 'folder', parentId: null, children: [fileId] },
    [fileId]: {
      id: fileId,
      name: 'main.js',
      type: 'file',
      parentId: rootId,
      content: '// Welcome to the Apollo IDE.\n// Create files and folders, then hit Run.\n\nconsole.log("Hello from Apollo");\n',
      language: 'javascript',
    },
  };
  return { rootId, nodes, openTabs: [fileId], activeFileId: fileId };
}

/**
 * Validates a persisted project's structural integrity.
 * Corrupt localStorage would otherwise crash the whole IDE on mount.
 */
function isProjectValid(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.rootId || !p.nodes || typeof p.nodes !== 'object') return false;
  const root = p.nodes[p.rootId];
  if (!root || root.type !== 'folder') return false;

  for (const [id, node] of Object.entries(p.nodes)) {
    if (!node || node.id !== id || !node.name || !node.type) return false;
    if (node.type === 'folder' && !Array.isArray(node.children)) return false;
    if (node.type === 'folder' && node.children.some((cid) => !p.nodes[cid])) return false;
  }
  return true;
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();

    const parsed = JSON.parse(raw);
    if (!isProjectValid(parsed)) {
      console.warn('[Apollo] Stored project failed validation — resetting to default.');
      return createDefaultProject();
    }

    // Drop tabs pointing at files that no longer exist.
    const openTabs = (parsed.openTabs || []).filter(
      (id) => parsed.nodes[id] && parsed.nodes[id].type === 'file'
    );
    const activeFileId = openTabs.includes(parsed.activeFileId)
      ? parsed.activeFileId
      : (openTabs[0] ?? null);

    return { ...parsed, openTabs, activeFileId };
  } catch (e) {
    console.error('[Apollo] Failed to load project, resetting to default:', e);
    return createDefaultProject();
  }
}

export function saveProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    // Most likely QuotaExceededError on a very large project.
    console.error('[Apollo] Failed to save project:', e);
  }
}

export function resetProject() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  return createDefaultProject();
}

/**
 * Updates the name of the project (root folder).
 */
export function updateProjectName(nodes, rootId, newName) {
  const root = nodes[rootId];
  if (!root) return nodes;
  const val = validateNodeName(newName);
  if (!val.ok) return nodes;
  return {
    ...nodes,
    [rootId]: { ...root, name: val.name }
  };
}

/**
 * Discovers the default entry point file for the whole project.
 * Matches the server-side logic in projectRunner.resolveEntry.
 */
export function findProjectEntryPoint(nodes, rootId, language) {
  const files = flattenToFileList(nodes, rootId);
  if (!files.length) return null;

  switch (language) {
    case 'javascript': {
      const preferred = ['main.js', 'index.js', 'app.js', 'server.js'];
      for (const name of preferred) {
        const found = files.find(f => f.path.toLowerCase() === name);
        if (found) return found.path;
      }
      // Check package.json main
      const pkg = files.find(f => f.path.toLowerCase() === 'package.json');
      if (pkg) {
        try {
          const main = JSON.parse(pkg.content)?.main;
          if (main && files.some(f => f.path === main)) return main;
        } catch { /* ignore */ }
      }
      const anyJs = files.find(f => f.path.endsWith('.js') && !f.path.includes('/'));
      return anyJs?.path || files.find(f => f.path.endsWith('.js'))?.path || files[0].path;
    }
    case 'python': {
      const preferred = ['main.py', 'app.py', 'run.py'];
      for (const name of preferred) {
        const found = files.find(f => f.path.toLowerCase() === name);
        if (found) return found.path;
      }
      const anyPy = files.find(f => f.path.endsWith('.py') && !f.path.includes('/'));
      return anyPy?.path || files.find(f => f.path.endsWith('.py'))?.path || files[0].path;
    }
    case 'cpp': {
      const withMain = files.find(f => /\.(cpp|cc|cxx|c)$/i.test(f.path) && /\bint\s+main\s*\(/.test(f.content));
      return withMain?.path || files.find(f => /\.(cpp|cc|cxx|c)$/i.test(f.path))?.path || null;
    }
    case 'java': {
      const withMain = files.find(f => f.path.endsWith('.java') && /public\s+static\s+void\s+main\s*\(/.test(f.content));
      return withMain?.path || files.find(f => f.path.endsWith('.java'))?.path || null;
    }
    default:
      return files[0]?.path || null;
  }
}

/**
 * Exports the project structure and contents as a downloadable JSON file.
 */
export function exportProjectAsJson(project) {
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = project.nodes[project.rootId]?.name || 'apollo-project';
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════
   Tree operations — all pure
   ═══════════════════════════════════════ */

/**
 * Creates a file or folder under `parentId`.
 * The name is auto-suffixed if it collides with a sibling (D4).
 * @returns {{ nodes: object, id: string, name: string }}
 */
export function createNode(nodes, parentId, name, type) {
  const parent = nodes[parentId];
  if (!parent || parent.type !== 'folder') {
    throw new Error('createNode: parent must be an existing folder');
  }

  const validation = validateNodeName(name);
  const safeName = uniqueName(nodes, parentId, validation.ok ? validation.name : 'untitled');
  const id = genId();

  const newNode =
    type === 'folder'
      ? { id, name: safeName, type, parentId, children: [] }
      : { id, name: safeName, type, parentId, content: '', language: getLanguageFromFilename(safeName) };

  return {
    nodes: {
      ...nodes,
      [id]: newNode,
      [parentId]: { ...parent, children: [...parent.children, id] },
    },
    id,
    name: safeName,
  };
}

/**
 * Renames a node. Unlike createNode this REJECTS collisions rather than
 * silently suffixing, so the user can correct their intent.
 * @returns {{ nodes: object, error: string|null }}
 */
export function renameNode(nodes, id, newName) {
  const node = nodes[id];
  if (!node) return { nodes, error: 'File no longer exists' };
  if (!node.parentId) return { nodes, error: 'The project root cannot be renamed' };

  const validation = validateNodeName(newName);
  if (!validation.ok) return { nodes, error: validation.error };

  const finalName = validation.name;
  if (finalName === node.name) return { nodes, error: null };

  if (hasSiblingWithName(nodes, node.parentId, finalName, id)) {
    return { nodes, error: `"${finalName}" already exists in this folder` };
  }

  const updated = { ...node, name: finalName };
  if (node.type === 'file') updated.language = getLanguageFromFilename(finalName);

  return { nodes: { ...nodes, [id]: updated }, error: null };
}

function collectDescendantIds(nodes, id) {
  const node = nodes[id];
  if (!node) return [];
  if (node.type === 'file') return [id];

  let ids = [id];
  for (const childId of node.children || []) {
    ids = ids.concat(collectDescendantIds(nodes, childId));
  }
  return ids;
}

/**
 * Deletes a node and all descendants. The root cannot be deleted.
 * @returns {{ nodes: object, deletedIds: string[] }}
 */
export function deleteNode(nodes, id) {
  const node = nodes[id];
  if (!node || !node.parentId) return { nodes, deletedIds: [] };

  const deletedIds = collectDescendantIds(nodes, id);
  const updatedNodes = { ...nodes };
  for (const delId of deletedIds) delete updatedNodes[delId];

  const parent = updatedNodes[node.parentId];
  if (parent) {
    updatedNodes[node.parentId] = {
      ...parent,
      children: parent.children.filter((cid) => cid !== id),
    };
  }

  return { nodes: updatedNodes, deletedIds };
}

export function updateFileContent(nodes, id, content) {
  const node = nodes[id];
  if (!node || node.type !== 'file') return nodes;
  return { ...nodes, [id]: { ...node, content } };
}

/* ═══════════════════════════════════════
   Path helpers
   ═══════════════════════════════════════ */

/**
 * Full path including the root folder name — used as Monaco's unique model
 * path so each file keeps its own undo history and view state.
 * e.g. "project/src/main.py"
 */
export function getNodePath(nodes, id) {
  const segments = [];
  let current = nodes[id];
  let guard = 0;

  while (current && guard++ < 500) {
    segments.unshift(current.name);
    current = current.parentId ? nodes[current.parentId] : null;
  }
  return segments.join('/');
}

/**
 * Path relative to the root folder (root name excluded) — this is what gets
 * sent to the server and written into the sandbox directory.
 * e.g. "src/main.py"
 */
export function getRelativePath(nodes, rootId, id) {
  const segments = [];
  let current = nodes[id];
  let guard = 0;

  while (current && current.id !== rootId && guard++ < 500) {
    segments.unshift(current.name);
    current = current.parentId ? nodes[current.parentId] : null;
  }
  return segments.join('/');
}

/**
 * Flattens the tree into the payload the run endpoint expects.
 * Folders are omitted — the server recreates them from the file paths.
 * @returns {{ path: string, content: string }[]}
 */
export function flattenToFileList(nodes, rootId) {
  const files = [];

  const walk = (id) => {
    const node = nodes[id];
    if (!node) return;
    if (node.type === 'file') {
      files.push({
        path: getRelativePath(nodes, rootId, id),
        content: node.content ?? '',
      });
      return;
    }
    for (const childId of node.children || []) walk(childId);
  };

  walk(rootId);
  return files;
}

/**
 * Picks the language to run the project as, by majority of runnable source
 * files, preferring the active file's language when it is runnable.
 */
export function detectProjectLanguage(nodes, rootId, activeFileId) {
  const activeLang = nodes[activeFileId]?.language;
  if (RUNNABLE_LANGUAGES.includes(activeLang)) return activeLang;

  const counts = {};
  for (const { path } of flattenToFileList(nodes, rootId)) {
    const lang = getLanguageFromFilename(path);
    if (RUNNABLE_LANGUAGES.includes(lang)) counts[lang] = (counts[lang] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : 'javascript';
}

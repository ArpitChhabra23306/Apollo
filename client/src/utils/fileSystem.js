/**
 * Apollo — Virtual File System
 * A lightweight in-browser file/folder tree for multi-file projects.
 * Persisted to localStorage (no backend model exists for this yet).
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
};

export function getLanguageFromFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_LANGUAGE_MAP[ext] || 'javascript';
}

export function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Creates the default starter project: one root folder containing main.js.
 */
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
      content: '// Type or paste your code here...\n',
      language: 'javascript',
    },
  };
  return { rootId, nodes, openTabs: [fileId], activeFileId: fileId };
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();
    const parsed = JSON.parse(raw);
    if (!parsed?.nodes || !parsed?.rootId) return createDefaultProject();
    return parsed;
  } catch (e) {
    console.error('Failed to load project, resetting to default:', e);
    return createDefaultProject();
  }
}

export function saveProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    console.error('Failed to save project:', e);
  }
}

/**
 * Creates a new file or folder node under `parentId`.
 * Pass `idOverride` to know the new id synchronously before state settles.
 */
export function createNode(nodes, parentId, name, type, idOverride) {
  const id = idOverride || genId();
  const newNode =
    type === 'folder'
      ? { id, name, type, parentId, children: [] }
      : { id, name, type, parentId, content: '', language: getLanguageFromFilename(name) };

  const parent = nodes[parentId];
  const updatedNodes = {
    ...nodes,
    [id]: newNode,
    [parentId]: { ...parent, children: [...(parent.children || []), id] },
  };
  return { nodes: updatedNodes, id };
}

export function renameNode(nodes, id, newName) {
  const node = nodes[id];
  if (!node) return nodes;
  const updated = { ...node, name: newName };
  if (node.type === 'file') updated.language = getLanguageFromFilename(newName);
  return { ...nodes, [id]: updated };
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
 * Deletes a node (and all descendants if it's a folder). Root cannot be deleted.
 * Returns the updated nodes map plus the list of deleted ids (useful for closing tabs).
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
  if (!node) return nodes;
  return { ...nodes, [id]: { ...node, content } };
}

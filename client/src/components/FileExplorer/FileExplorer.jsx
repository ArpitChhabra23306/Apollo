import { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import './FileExplorer.css';

const FILE_ICON_MAP = {
  js: 'FileCode', jsx: 'FileCode', mjs: 'FileCode', cjs: 'FileCode',
  py: 'FileCode', java: 'FileCode', cpp: 'FileCode', cc: 'FileCode',
  cxx: 'FileCode', h: 'FileCode', hpp: 'FileCode', c: 'FileCode',
};

function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return FILE_ICON_MAP[ext] || 'File';
}

/**
 * Recursive VS Code-style file tree node.
 */
function TreeNode({
  id,
  nodes,
  depth,
  activeFileId,
  expandedIds,
  onToggleExpand,
  onSelectFile,
  onRequestCreate,
  onRequestRename,
  onRequestDelete,
  renamingId,
  onSubmitRename,
  onCancelRename,
}) {
  const node = nodes[id];
  if (!node) return null;

  const [contextMenu, setContextMenu] = useState(null);
  const [renameValue, setRenameValue] = useState(node.name);

  const isFolder = node.type === 'folder';
  const isExpanded = expandedIds.has(id);
  const isActive = activeFileId === id;
  const isRenaming = renamingId === id;

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleClick = () => {
    if (isFolder) onToggleExpand(id);
    else onSelectFile(id);
  };

  const submitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name) onSubmitRename(id, trimmed);
    else onCancelRename();
  };

  return (
    <div className="fe-node-wrapper">
      <div
        className={`fe-node ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={node.name}
      >
        {isFolder && (
          <LucideIcons.ChevronRight
            size={13}
            className={`fe-chevron ${isExpanded ? 'expanded' : ''}`}
          />
        )}
        {isFolder ? (
          <LucideIcons.Folder size={14} color="#9B40E0" />
        ) : (
          (() => {
            const Icon = LucideIcons[getFileIcon(node.name)] || LucideIcons.File;
            return <Icon size={14} color="#7d8590" />;
          })()
        )}
        {isRenaming ? (
          <input
            autoFocus
            className="fe-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            onBlur={submitRename}
          />
        ) : (
          <span className="fe-node-name">{node.name}</span>
        )}
      </div>

      {isFolder && isExpanded && (
        <div className="fe-children">
          {(node.children || []).map((childId) => (
            <TreeNode
              key={childId}
              id={childId}
              nodes={nodes}
              depth={depth + 1}
              activeFileId={activeFileId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelectFile={onSelectFile}
              onRequestCreate={onRequestCreate}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              renamingId={renamingId}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </div>
      )}

      {contextMenu && (
        <>
          <div className="fe-menu-backdrop" onClick={closeContextMenu} onContextMenu={closeContextMenu} />
          <div className="fe-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {isFolder && (
              <>
                <button onClick={() => { onRequestCreate(id, 'file'); closeContextMenu(); }}>
                  <LucideIcons.FilePlus size={13} /> New File
                </button>
                <button onClick={() => { onRequestCreate(id, 'folder'); closeContextMenu(); }}>
                  <LucideIcons.FolderPlus size={13} /> New Folder
                </button>
                <div className="fe-menu-divider" />
              </>
            )}
            {node.parentId && (
              <>
                <button onClick={() => { onRequestRename(id); closeContextMenu(); }}>
                  <LucideIcons.Pencil size={13} /> Rename
                </button>
                <button className="fe-menu-danger" onClick={() => { onRequestDelete(id); closeContextMenu(); }}>
                  <LucideIcons.Trash2 size={13} /> Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * File Explorer panel — VS Code-style tree with create/rename/delete.
 */
function FileExplorer({
  project,
  onSelectFile,
  onCreateNode,
  onRenameNode,
  onDeleteNode,
}) {
  const { nodes, rootId } = project;
  const [expandedIds, setExpandedIds] = useState(new Set([rootId]));
  const [renamingId, setRenamingId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRequestCreate = (parentId, type) => {
    setExpandedIds((prev) => new Set(prev).add(parentId));
    const defaultName = type === 'folder' ? 'new-folder' : 'new-file.js';
    onCreateNode(parentId, defaultName, type);
  };

  const handleRequestDelete = (id) => {
    const node = nodes[id];
    if (!node) return;
    const label = node.type === 'folder' ? 'this folder and everything inside it' : `"${node.name}"`;
    if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
      onDeleteNode(id);
    }
  };

  return (
    <div className="fe-root">
      <div className="fe-header">
        <span>EXPLORER</span>
        <div className="fe-header-actions">
          <button title="New File" onClick={() => handleRequestCreate(rootId, 'file')}>
            <LucideIcons.FilePlus size={13} />
          </button>
          <button title="New Folder" onClick={() => handleRequestCreate(rootId, 'folder')}>
            <LucideIcons.FolderPlus size={13} />
          </button>
        </div>
      </div>
      <div className="fe-tree">
        {(nodes[rootId]?.children || []).map((childId) => (
          <TreeNode
            key={childId}
            id={childId}
            nodes={nodes}
            depth={0}
            activeFileId={project.activeFileId}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onSelectFile={onSelectFile}
            onRequestCreate={handleRequestCreate}
            onRequestRename={setRenamingId}
            onRequestDelete={handleRequestDelete}
            renamingId={renamingId}
            onSubmitRename={(id, newName) => { onRenameNode(id, newName); setRenamingId(null); }}
            onCancelRename={() => setRenamingId(null)}
          />
        ))}
        {(nodes[rootId]?.children || []).length === 0 && (
          <div className="fe-empty">No files yet. Right-click to create one.</div>
        )}
      </div>
    </div>
  );
}

export default FileExplorer;

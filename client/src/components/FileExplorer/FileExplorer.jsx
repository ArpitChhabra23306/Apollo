import { useState, useEffect, useCallback } from 'react';
import * as LucideIcons from 'lucide-react';
import './FileExplorer.css';

const LANG_ICON_COLOR = {
  javascript: '#f0db4f',
  python: '#4b8bbe',
  java: '#e76f00',
  cpp: '#00599c',
  json: '#8b949e',
  markdown: '#8b949e',
  css: '#563d7c',
  html: '#e34c26',
  plaintext: '#7d8590',
};

function FileIcon({ language, size = 14 }) {
  const color = LANG_ICON_COLOR[language] || '#7d8590';
  const Icon = language === 'plaintext' ? LucideIcons.File : LucideIcons.FileCode;
  return <Icon size={size} color={color} />;
}

/**
 * Recursive VS Code-style tree row.
 *
 * All hooks are declared before any conditional return — a missing node must not
 * change hook call order between renders (defect D2).
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
  onRequestDelete,
  renamingId,
  renameValue,
  onRenameValueChange,
  renameError,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onOpenMenu,
  menuNodeId,
}) {
  const node = nodes[id];
  const isRenaming = renamingId === id;

  if (!node) return null;

  const isFolder = node.type === 'folder';
  const isExpanded = expandedIds.has(id);
  const isActive = activeFileId === id;
  const isMenuTarget = menuNodeId === id;

  const submitRename = () => {
    if (renameValue.trim() === node.name) return onCancelRename();
    onSubmitRename(id, renameValue);
  };

  return (
    <div className="fe-node-wrapper">
      <div
        className={`fe-node ${isActive ? 'active' : ''} ${isMenuTarget ? 'menu-target' : ''}`}
        style={{ paddingLeft: `${6 + depth * 13}px` }}
        onClick={() => (isFolder ? onToggleExpand(id) : onSelectFile(id))}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu({ nodeId: id, x: e.clientX, y: e.clientY });
        }}
        title={node.name}
        role="treeitem"
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isActive}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isFolder ? onToggleExpand(id) : onSelectFile(id);
          }
          if (e.key === 'F2') { e.preventDefault(); onStartRename(id); }
          if (e.key === 'Delete') { e.preventDefault(); onRequestDelete(id); }
        }}
      >
        <span className="fe-chevron-slot">
          {isFolder && (
            <LucideIcons.ChevronRight
              size={13}
              className={`fe-chevron ${isExpanded ? 'expanded' : ''}`}
            />
          )}
        </span>

        {isFolder ? (
          isExpanded
            ? <LucideIcons.FolderOpen size={14} color="#9B40E0" />
            : <LucideIcons.Folder size={14} color="#9B40E0" />
        ) : (
          <FileIcon language={node.language} />
        )}

        {isRenaming ? (
          <input
            // autoFocus + onFocus avoids a setState-in-effect for selection.
            autoFocus
            onFocus={(e) => {
              const dot = node.name.lastIndexOf('.');
              e.target.setSelectionRange(0, dot > 0 ? dot : node.name.length);
            }}
            className={`fe-rename-input ${renameError ? 'has-error' : ''}`}
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            onBlur={submitRename}
            spellCheck={false}
            aria-label="New name"
            aria-invalid={!!renameError}
          />
        ) : (
          <span className="fe-node-name">{node.name}</span>
        )}
      </div>

      {isRenaming && renameError && (
        <div className="fe-rename-error" style={{ marginLeft: `${6 + depth * 13}px` }}>
          {renameError}
        </div>
      )}

      {isFolder && isExpanded && (
        <div className="fe-children" role="group">
          {node.children.length === 0 && (
            <div className="fe-empty-folder" style={{ paddingLeft: `${6 + (depth + 1) * 13 + 20}px` }}>
              empty
            </div>
          )}
          {node.children.map((childId) => (
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
              onRequestDelete={onRequestDelete}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              renameError={renameError}
              onStartRename={onStartRename}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onOpenMenu={onOpenMenu}
              menuNodeId={menuNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * File Explorer panel — VS Code-style tree with create / rename / delete.
 *
 * The context menu is rendered once at this level (not per row) so only one can
 * ever be open, and it escapes the sidebar's overflow via position: fixed.
 */
function FileExplorer({ project, onSelectFile, onCreateNode, onRenameNode, onDeleteNode }) {
  const { nodes, rootId } = project;

  const [expandedIds, setExpandedIds] = useState(() => new Set([rootId]));
  const [renamingId, setRenamingId] = useState(null);
  // Rename draft lives here, not in TreeNode, so it is seeded fresh every time
  // renaming starts and can never go stale (defect D3).
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [menu, setMenu] = useState(null); // { nodeId, x, y }

  const closeMenu = useCallback(() => setMenu(null), []);

  // Close the menu on Escape or on any scroll (its fixed position would detach).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menu, closeMenu]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const startRename = useCallback((id, seedName) => {
    setRenameError(null);
    setRenameValue(seedName ?? nodes[id]?.name ?? '');
    setRenamingId(id);
  }, [nodes]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback((id, newName) => {
    const error = onRenameNode(id, newName);
    if (error) {
      setRenameError(error); // keep the input open so the user can fix it
    } else {
      setRenamingId(null);
      setRenameValue('');
      setRenameError(null);
    }
  }, [onRenameNode]);

  const handleCreate = useCallback((parentId, type) => {
    // Creating inside a collapsed folder should reveal the result.
    setExpandedIds((prev) => new Set(prev).add(parentId));
    const created = onCreateNode(parentId, type === 'folder' ? 'new-folder' : 'new-file.js', type);
    // Immediately offer a rename so the user names it rather than keeping the default.
    // Seed from the returned name since `nodes` here is still the pre-create snapshot.
    if (created?.id) startRename(created.id, created.name);
  }, [onCreateNode, startRename]);

  const handleDelete = useCallback((id) => {
    const node = nodes[id];
    if (!node) return;
    const what = node.type === 'folder'
      ? `the folder "${node.name}" and everything inside it`
      : `"${node.name}"`;
    if (window.confirm(`Delete ${what}?\n\nThis cannot be undone.`)) {
      onDeleteNode(id);
    }
  }, [nodes, onDeleteNode]);

  // Right-clicking blank space targets the root folder.
  const handleRootContextMenu = (e) => {
    e.preventDefault();
    setMenu({ nodeId: rootId, x: e.clientX, y: e.clientY });
  };

  const menuNode = menu ? nodes[menu.nodeId] : null;
  const rootChildren = nodes[rootId]?.children ?? [];

  const getTargetParentId = useCallback(() => {
    if (project.activeFileId && nodes[project.activeFileId]) {
      const activeNode = nodes[project.activeFileId];
      return activeNode.type === 'folder' ? activeNode.id : (activeNode.parentId || rootId);
    }
    return rootId;
  }, [project.activeFileId, nodes, rootId]);

  return (
    <div className="fe-root">
      <div className="fe-header">
        <span className="fe-header-title">Explorer</span>
        <div className="fe-header-actions">
          <button type="button" title="New File" aria-label="New File"
            onClick={() => handleCreate(getTargetParentId(), 'file')}>
            <LucideIcons.FilePlus size={14} />
          </button>
          <button type="button" title="New Folder" aria-label="New Folder"
            onClick={() => handleCreate(getTargetParentId(), 'folder')}>
            <LucideIcons.FolderPlus size={14} />
          </button>
          <button type="button" title="Collapse All" aria-label="Collapse All"
            onClick={() => setExpandedIds(new Set([rootId]))}>
            <LucideIcons.ChevronsDownUp size={14} />
          </button>
        </div>
      </div>

      <div className="fe-project-name" title={nodes[rootId]?.name}>
        <LucideIcons.FolderTree size={12} />
        <span>{nodes[rootId]?.name ?? 'project'}</span>
      </div>

      <div className="fe-tree" role="tree" onContextMenu={handleRootContextMenu}>
        {rootChildren.map((childId) => (
          <TreeNode
            key={childId}
            id={childId}
            nodes={nodes}
            depth={0}
            activeFileId={project.activeFileId}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onSelectFile={onSelectFile}
            onRequestCreate={handleCreate}
            onRequestDelete={handleDelete}
            renamingId={renamingId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            renameError={renameError}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={cancelRename}
            onOpenMenu={setMenu}
            menuNodeId={menu?.nodeId ?? null}
          />
        ))}

        {rootChildren.length === 0 && (
          <div className="fe-empty">
            No files yet.
            <button type="button" onClick={() => handleCreate(rootId, 'file')}>
              Create one
            </button>
          </div>
        )}
      </div>

      {menu && menuNode && (
        <>
          <div className="fe-menu-backdrop" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            className="fe-context-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
          >
            {menuNode.type === 'folder' && (
              <>
                <button type="button" role="menuitem"
                  onClick={() => { handleCreate(menu.nodeId, 'file'); closeMenu(); }}>
                  <LucideIcons.FilePlus size={13} /> New File
                </button>
                <button type="button" role="menuitem"
                  onClick={() => { handleCreate(menu.nodeId, 'folder'); closeMenu(); }}>
                  <LucideIcons.FolderPlus size={13} /> New Folder
                </button>
              </>
            )}

            {menuNode.parentId && (
              <>
                {menuNode.type === 'folder' && <div className="fe-menu-divider" />}
                <button type="button" role="menuitem"
                  onClick={() => { startRename(menu.nodeId); closeMenu(); }}>
                  <LucideIcons.Pencil size={13} /> Rename
                  <kbd>F2</kbd>
                </button>
                <button type="button" role="menuitem" className="fe-menu-danger"
                  onClick={() => { const id = menu.nodeId; closeMenu(); handleDelete(id); }}>
                  <LucideIcons.Trash2 size={13} /> Delete
                  <kbd>Del</kbd>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default FileExplorer;

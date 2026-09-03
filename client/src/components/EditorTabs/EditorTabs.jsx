import { useRef, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import './EditorTabs.css';

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

/**
 * VS Code-style open-file tab strip.
 *
 * There is intentionally no "unsaved/dirty" indicator: edits persist to
 * localStorage continuously, so there is no unsaved state to represent.
 */
function EditorTabs({ openTabs, nodes, activeFileId, onSelect, onClose, onCloseOthers, onCloseAll }) {
  const stripRef = useRef(null);
  const activeRef = useRef(null);

  // Keep the active tab in view when it changes (e.g. selected from the tree).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeFileId]);

  // Translate vertical wheel into horizontal scroll, like VS Code.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.deltaY === 0) return;
      // Only hijack when there is actually something to scroll.
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!openTabs.length) return null;

  return (
    <div className="et-root">
      <div className="et-strip" ref={stripRef} role="tablist">
        {openTabs.map((id) => {
          const node = nodes[id];
          if (!node) return null;

          const isActive = id === activeFileId;
          const color = LANG_ICON_COLOR[node.language] || '#7d8590';
          const Icon = node.language === 'plaintext' ? LucideIcons.File : LucideIcons.FileCode;

          return (
            <div
              key={id}
              ref={isActive ? activeRef : null}
              className={`et-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(id)}
              onAuxClick={(e) => {
                if (e.button === 1) { e.preventDefault(); onClose(id); }
              }}
              title={node.name}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); }
                if (e.key === 'w' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onClose(id); }
              }}
            >
              <Icon size={13} color={color} />
              <span className="et-tab-name">{node.name}</span>
              <button
                type="button"
                className="et-tab-close"
                onClick={(e) => { e.stopPropagation(); onClose(id); }}
                title={`Close ${node.name}`}
                aria-label={`Close ${node.name}`}
                tabIndex={-1}
              >
                <LucideIcons.X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {openTabs.length > 1 && (
        <div className="et-actions">
          <button type="button" title="Close other tabs" onClick={() => onCloseOthers?.(activeFileId)}>
            <LucideIcons.Columns2 size={13} />
          </button>
          <button type="button" title="Close all tabs" onClick={() => onCloseAll?.()}>
            <LucideIcons.XCircle size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default EditorTabs;

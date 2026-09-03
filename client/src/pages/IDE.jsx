import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import * as LucideIcons from 'lucide-react';

import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

import CodeEditor from '../components/CodeEditor/CodeEditor';
import FileExplorer from '../components/FileExplorer/FileExplorer';
import EditorTabs from '../components/EditorTabs/EditorTabs';
import Terminal from '../components/Terminal/Terminal';
import { streamAIChat, API_BASE } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { EDITOR_MODES } from '../modes/modeConfig';
import {
  loadProject, saveProject, resetProject,
  createNode, renameNode, deleteNode, updateFileContent,
  updateProjectName, findProjectEntryPoint, exportProjectAsJson,
  getNodePath, getRelativePath, flattenToFileList,
  detectProjectLanguage, RUNNABLE_LANGUAGES,
} from '../utils/fileSystem';
import './IDE.css';

const LANG_LABEL = {
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  json: 'JSON',
  markdown: 'Markdown',
  css: 'CSS',
  html: 'HTML',
  plaintext: 'Plain Text',
};

function ModeIcon({ name, size = 15, color, strokeWidth = 1.8 }) {
  const Icon = LucideIcons[name];
  if (!Icon) return null;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}

function IDE() {
  /* ── Project state ── */
  const [project, setProject] = useState(loadProject);
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving'
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');

  /* ── Layout ── */
  const [activityView, setActivityView] = useState('files'); // 'files' | 'ai'
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [aiPanelWidth, setAiPanelWidth] = useState(360);
  const [drawerHeight, setDrawerHeight] = useState(220);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false); // Closed by default for full editor view!

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('apollo-theme');
    return saved ? saved === 'dark' : true;
  });

  /* ── Execution ── */
  const [running, setRunning] = useState(false);
  const [lastExit, setLastExit] = useState(null);
  const [socketReady, setSocketReady] = useState(false);
  const socketRef = useRef(null);

  /* ── AI panel ── */
  const [activeMode, setActiveMode] = useState(EDITOR_MODES[0]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const chatEndRef = useRef(null);

  /* ── Derived values ──
     Everything downstream reads these, so the rest of the page never needs to
     know the project is a tree rather than a single string. */
  const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
  const code = activeFile?.content ?? '';
  const language = activeFile?.language ?? 'plaintext';
  const activePath = useMemo(
    () => (activeFile ? getNodePath(project.nodes, activeFile.id) : null),
    [activeFile, project.nodes]
  );
  const runLanguage = useMemo(
    () => detectProjectLanguage(project.nodes, project.rootId, project.activeFileId),
    [project.nodes, project.rootId, project.activeFileId]
  );
  const canRun = RUNNABLE_LANGUAGES.includes(runLanguage) && !!activeFile;

  // Find the primary entry point for the whole project (main.js, main.py, etc.)
  const projectEntryPoint = useMemo(
    () => findProjectEntryPoint(project.nodes, project.rootId, runLanguage),
    [project.nodes, project.rootId, runLanguage]
  );

  /* ── Persist (debounced so typing doesn't hammer localStorage) ── */
  useEffect(() => {
    setSaveStatus('saving');
    const t = setTimeout(() => {
      saveProject(project);
      setSaveStatus('saved');
    }, 250);
    return () => clearTimeout(t);
  }, [project]);

  /* ── Unload flush — guarantees zero data loss on close/refresh ── */
  useEffect(() => {
    const flushSave = () => {
      if (projectRef.current) {
        saveProject(projectRef.current);
      }
    };
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
    return () => {
      window.removeEventListener('beforeunload', flushSave);
      window.removeEventListener('pagehide', flushSave);
    };
  }, []);



  /* ── Theme ── */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark-mode', darkMode);
    root.classList.toggle('light-mode', !darkMode);
    localStorage.setItem('apollo-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Terminal socket lifecycle ──
     The socket lives in a ref rather than state so the effect never calls
     setState synchronously. `socketReady` flipping on connect is what triggers
     the re-render that hands the socket down to <Terminal />. */
  useEffect(() => {
    const s = io(API_BASE, { transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('connect', () => setSocketReady(true));
    s.on('disconnect', () => { setSocketReady(false); setRunning(false); });
    s.on('connect_error', () => setSocketReady(false));

    // Run lifecycle — <Terminal /> renders the actual output itself.
    s.on('project:started', () => setRunning(true));
    s.on('project:exit', (summary) => { setRunning(false); setLastExit(summary); });
    s.on('project:error', () => setRunning(false));

    return () => {
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  /* ═══════════ Panel resizing ═══════════ */
  const dragging = useRef(null);
  const dragStart = useRef({ pos: 0, size: 0 });

  const beginDrag = useCallback((which, e) => {
    e.preventDefault();
    dragging.current = which;
    const vertical = which === 'drawer';
    dragStart.current = {
      pos: vertical ? e.clientY : e.clientX,
      size: which === 'sidebar' ? sidebarWidth : which === 'ai' ? aiPanelWidth : drawerHeight,
    };
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth, aiPanelWidth, drawerHeight]);

  useEffect(() => {
    const onMove = (e) => {
      const which = dragging.current;
      if (!which) return;

      if (which === 'sidebar') {
        const delta = e.clientX - dragStart.current.pos;
        setSidebarWidth(Math.max(180, Math.min(480, dragStart.current.size + delta)));
      } else if (which === 'ai') {
        // AI panel is on the right, so dragging left grows it.
        const delta = dragStart.current.pos - e.clientX;
        setAiPanelWidth(Math.max(280, Math.min(640, dragStart.current.size + delta)));
      } else if (which === 'drawer') {
        const delta = dragStart.current.pos - e.clientY;
        setDrawerHeight(Math.max(120, Math.min(560, dragStart.current.size + delta)));
      }
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  /* ═══════════ File tree handlers ═══════════ */

  const handleSelectFile = useCallback((id) => {
    setProject((p) => {
      if (!p.nodes[id] || p.nodes[id].type !== 'file') return p;
      return {
        ...p,
        activeFileId: id,
        openTabs: p.openTabs.includes(id) ? p.openTabs : [...p.openTabs, id],
      };
    });
  }, []);

  const handleCloseTab = useCallback((id) => {
    setProject((p) => {
      const idx = p.openTabs.indexOf(id);
      if (idx === -1) return p;

      const openTabs = p.openTabs.filter((t) => t !== id);
      let activeFileId = p.activeFileId;

      if (activeFileId === id) {
        // Prefer the tab to the left, then the right, else nothing.
        activeFileId = openTabs[idx - 1] ?? openTabs[idx] ?? null;
      }
      return { ...p, openTabs, activeFileId };
    });
  }, []);

  const handleCloseOthers = useCallback((keepId) => {
    setProject((p) => ({
      ...p,
      openTabs: p.openTabs.filter((t) => t === keepId),
      activeFileId: keepId,
    }));
  }, []);

  const handleCloseAll = useCallback(() => {
    setProject((p) => ({ ...p, openTabs: [], activeFileId: null }));
  }, []);

  // Must return { id, name } — FileExplorer uses it to start an inline rename.
  const handleCreateNode = useCallback((parentId, name, type) => {
    let created = null;
    setProject((p) => {
      const res = createNode(p.nodes, parentId, name, type);
      created = { id: res.id, name: res.name };
      const isFile = type === 'file';
      return {
        ...p,
        nodes: res.nodes,
        openTabs: isFile ? [...p.openTabs, res.id] : p.openTabs,
        activeFileId: isFile ? res.id : p.activeFileId,
      };
    });
    return created;
  }, []);

  // Must return an error string, or null on success.
  const handleRenameNode = useCallback((id, newName) => {
    let error = null;
    setProject((p) => {
      const res = renameNode(p.nodes, id, newName);
      error = res.error;
      return res.error ? p : { ...p, nodes: res.nodes };
    });
    return error;
  }, []);

  const handleDeleteNode = useCallback((id) => {
    setProject((p) => {
      const { nodes, deletedIds } = deleteNode(p.nodes, id);
      if (!deletedIds.length) return p;

      const gone = new Set(deletedIds);
      const openTabs = p.openTabs.filter((t) => !gone.has(t));
      const activeFileId = gone.has(p.activeFileId)
        ? (openTabs[openTabs.length - 1] ?? null)
        : p.activeFileId;

      return { ...p, nodes, openTabs, activeFileId };
    });
  }, []);

  const handleEditorChange = useCallback((value) => {
    setProject((p) => (
      p.activeFileId ? { ...p, nodes: updateFileContent(p.nodes, p.activeFileId, value) } : p
    ));
  }, []);

  const handleManualSave = () => {
    saveProject(projectRef.current);
    setSaveStatus('saved');
    toast.success('Project saved', { duration: 1500, id: 'ide-save' });
  };

  const projectName = project.nodes[project.rootId]?.name || 'project';

  const handleStartRenameProject = () => {
    setProjectNameInput(projectName);
    setIsRenamingProject(true);
  };

  const handleCommitProjectName = () => {
    if (projectNameInput.trim() && projectNameInput.trim() !== projectName) {
      setProject((p) => ({
        ...p,
        nodes: updateProjectName(p.nodes, p.rootId, projectNameInput.trim()),
      }));
      toast.success(`Project renamed to "${projectNameInput.trim()}"`);
    }
    setIsRenamingProject(false);
  };

  const handleResetProject = () => {
    if (window.confirm('Reset the workspace to a fresh project?\n\nAll files here will be permanently deleted.')) {
      setProject(resetProject());
      setLastExit(null);
      setMessages([]);
      toast.success('Workspace reset to default');
    }
  };

  /* ═══════════ Run ═══════════
     Sends the whole tree over the socket so output streams back live and the
     program's stdin stays open for interactive input.
     By default, executes the current active file (with all project files loaded for imports). */
  const handleRun = useCallback((targetFileId = null) => {
    if (!canRun || running || !socketRef.current || !socketReady) return;

    setLastExit(null);
    setDrawerOpen(true);
    setRunning(true);

    const files = flattenToFileList(project.nodes, project.rootId);
    
    // Prioritize running the current active file so whatever the user is editing runs immediately!
    const chosenNode = targetFileId ? project.nodes[targetFileId] : activeFile;
    let entry = undefined;
    let targetLang = runLanguage;

    if (chosenNode && RUNNABLE_LANGUAGES.includes(chosenNode.language)) {
      entry = getRelativePath(project.nodes, project.rootId, chosenNode.id);
      targetLang = chosenNode.language;
    } else if (projectEntryPoint) {
      entry = projectEntryPoint;
    }

    socketRef.current.emit('project:run', { files, language: targetLang, entry });
  }, [canRun, running, socketReady, project.nodes, project.rootId, activeFile, projectEntryPoint, runLanguage]);

  const handleKill = useCallback(() => {
    socketRef.current?.emit('project:kill');
  }, []);

  /* ── Keyboard Shortcuts (VS Code Style) ── */
  useEffect(() => {
    const onKey = (e) => {
      // Save: Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject(projectRef.current);
        setSaveStatus('saved');
        toast.success('Project saved', { duration: 1500, id: 'ide-save' });
      }
      // Run: Ctrl+Enter or F5
      if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || e.key === 'F5') {
        e.preventDefault();
        handleRun(false);
      }
      // Toggle Terminal Drawer: Ctrl+`
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setDrawerOpen((v) => !v);
      }
      // Stop running program on Escape if drawer is open
      if (e.key === 'Escape' && running) {
        handleKill();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRun, handleKill, running]);

  /* ═══════════ AI ═══════════ */

  const appendToLastMessage = (text) => {
    setMessages((prev) => {
      const next = [...prev];
      const i = next.length - 1;
      if (i < 0) return prev;
      next[i] = { ...next[i], content: (next[i].content || '') + text };
      return next;
    });
  };

  const runQuickAction = async (modeKey) => {
    const targetMode = EDITOR_MODES.find((m) => m.key === modeKey) || activeMode;
    setActiveMode(targetMode);
    setAiPanelOpen(true);
    if (!activeFile || !code.trim() || aiLoading) return;
    setAiLoading(true);
    setMessages([
      { role: 'user', content: `Run ${targetMode.label} on \`${activeFile.name}\`.` },
      { role: 'model', content: '' },
    ]);

    await streamAIChat({
      code, language, mode: targetMode.key, history: [],
      onChunk: appendToLastMessage,
      onError: () => appendToLastMessage('\n\n**Error: could not generate a response.**'),
    });
    setAiLoading(false);
  };

  const handleAskAI = async () => {
    setAiPanelOpen(true);
    if (!activeFile || !code.trim() || aiLoading) return;
    setAiLoading(true);
    setMessages([
      { role: 'user', content: `Run ${activeMode.label} on \`${activeFile.name}\`.` },
      { role: 'model', content: '' },
    ]);

    await streamAIChat({
      code, language, mode: activeMode.key, history: [],
      onChunk: appendToLastMessage,
      onError: () => appendToLastMessage('\n\n**Error: could not generate a response.**'),
    });
    setAiLoading(false);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || aiLoading) return;
    const input = chatInput;
    setChatInput('');
    setAiLoading(true);

    const history = [...messages, { role: 'user', content: input }];
    setMessages([...history, { role: 'model', content: '' }]);

    await streamAIChat({
      code, language, mode: activeMode.key, history,
      onChunk: appendToLastMessage,
      onError: () => appendToLastMessage('\n\n**Error: could not generate a response.**'),
    });
    setAiLoading(false);
  };

  const handleSelectMode = (mode) => {
    setActiveMode(mode);
    setMessages([]);
    setChatInput('');
  };

  /* ═══════════ Render ═══════════ */

  return (
    <div className={`ide-root ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      {/* ── TOP BAR ── */}
      <header className="ide-topbar">
        <div className="ide-topbar-left">
          <div className="ide-logo" onClick={() => navigate('/')} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/')}>
            <LucideIcons.Sparkles size={16} color="#9B40E0" />
            <span>Apollo</span>
          </div>
          <span className="ide-divider" />
          <span className="ide-badge-ide">IDE</span>

          {/* Project Title (editable) */}
          <div className="ide-project-title-area">
            {isRenamingProject ? (
              <input
                autoFocus
                className="ide-project-rename-input"
                value={projectNameInput}
                onChange={(e) => setProjectNameInput(e.target.value)}
                onBlur={handleCommitProjectName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitProjectName();
                  if (e.key === 'Escape') setIsRenamingProject(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="ide-project-name-btn"
                onClick={handleStartRenameProject}
                title="Click to rename project"
              >
                <LucideIcons.FolderGit2 size={13} color="#9B40E0" />
                <span>{projectName}</span>
                <LucideIcons.Pencil size={10} className="ide-edit-hint" />
              </button>
            )}
          </div>

          {/* Save Status Badge */}
          <div
            className={`ide-save-pill ${saveStatus}`}
            onClick={handleManualSave}
            title="Saved in browser storage. Click or press Ctrl+S to save immediately."
          >
            {saveStatus === 'saving' ? (
              <>
                <LucideIcons.Loader2 size={11} className="ide-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <LucideIcons.Check size={11} color="#22c55e" />
                <span>Saved</span>
              </>
            )}
          </div>

          <span className="ide-lang-badge" title={`Active file language: ${LANG_LABEL[language] || language}`}>
            {LANG_LABEL[language] || language}
          </span>
        </div>

        {/* Center Actions: Run Whole Project, Terminal, AI Assistant */}
        <div className="ide-topbar-center">
          {running ? (
            <button className="ide-btn ide-btn-stop" onClick={handleKill} title="Stop the running program (Ctrl+C)">
              <LucideIcons.Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <div className="ide-run-group">
              <button
                className="ide-btn ide-btn-run"
                onClick={() => handleRun()}
                disabled={!canRun || !socketReady}
                title={
                  !socketReady
                    ? 'Connecting to execution server…'
                    : `Run ${activeFile?.name || 'Code'} (Ctrl+Enter / F5)`
                }
              >
                <LucideIcons.Play size={13} fill="currentColor" />
                <span>Run {activeFile ? activeFile.name : 'Code'}</span>
              </button>

              {projectEntryPoint && activeFile?.name !== projectEntryPoint && (
                <button
                  type="button"
                  className="ide-btn ide-btn-run-secondary"
                  onClick={() => {
                    const mainNode = Object.values(project.nodes).find(
                      (n) => n.type === 'file' && getRelativePath(project.nodes, project.rootId, n.id) === projectEntryPoint
                    );
                    handleRun(mainNode?.id);
                  }}
                  disabled={!socketReady}
                  title={`Run Project Main Entry (${projectEntryPoint})`}
                >
                  <LucideIcons.PlayCircle size={12} />
                  <span>Run {projectEntryPoint}</span>
                </button>
              )}
            </div>
          )}

          <button
            className={`ide-btn ide-btn-plain ${drawerOpen ? 'active' : ''}`}
            onClick={() => setDrawerOpen((v) => !v)}
            title="Toggle terminal drawer"
          >
            <LucideIcons.Terminal size={13} /> Terminal
          </button>

          <button
            className={`ide-btn ide-btn-ai ${aiPanelOpen ? 'active' : ''}`}
            onClick={() => setAiPanelOpen((v) => !v)}
            title="Toggle AI Assistant (operates on active file)"
          >
            <LucideIcons.Sparkles size={13} color="#9B40E0" />
            <span>AI Assistant</span>
          </button>
        </div>

        {/* Right Actions: Export, Reset, Theme, User */}
        <div className="ide-topbar-right">
          <button
            className="ide-icon-btn"
            onClick={() => exportProjectAsJson(project)}
            title="Export & Download Project (JSON)"
          >
            <LucideIcons.Download size={14} />
          </button>
          <button className="ide-icon-btn" onClick={handleResetProject} title="Reset workspace to default">
            <LucideIcons.RotateCcw size={14} />
          </button>
          <button className="ide-icon-btn" onClick={() => setDarkMode((v) => !v)} title="Toggle theme">
            {darkMode ? <LucideIcons.Moon size={14} /> : <LucideIcons.Sun size={14} />}
          </button>
          <button className="ide-icon-btn" onClick={() => navigate('/workspace')} title="Back to Workspace">
            <LucideIcons.LayoutGrid size={14} />
          </button>
          <span className="ide-divider" />
          <div className="ide-user">
            <div className="ide-avatar">{(user?.username || 'U').charAt(0).toUpperCase()}</div>
            <span>{user?.username || 'User'}</span>
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="ide-body">
        {/* Activity bar */}
        <nav className="ide-activity" aria-label="Activity bar">
          <button
            className={`ide-activity-btn ${activityView === 'files' && !sidebarCollapsed ? 'active' : ''}`}
            onClick={() => {
              if (activityView === 'files') setSidebarCollapsed((v) => !v);
              else { setActivityView('files'); setSidebarCollapsed(false); }
            }}
            aria-label="Files Explorer"
          >
            <LucideIcons.Files size={20} />
          </button>
          <button
            className={`ide-activity-btn ${aiPanelOpen ? 'active' : ''}`}
            onClick={() => setAiPanelOpen((v) => !v)}
            aria-label="Toggle AI Assistant"
          >
            <LucideIcons.Sparkles size={20} />
          </button>

          <div className="ide-activity-spacer" />

          <button className="ide-activity-btn" onClick={() => navigate('/duel')} aria-label="Speed Code Duel" title="1v1 Speed Code Duel Arena">
            <LucideIcons.Swords size={20} color="#facc15" />
          </button>
          <button className="ide-activity-btn" onClick={() => navigate('/interview')} aria-label="Interview Prep">
            <LucideIcons.ShieldCheck size={20} />
          </button>
          <button className="ide-activity-btn" onClick={() => navigate('/focus')} aria-label="Focus Session">
            <LucideIcons.Target size={20} />
          </button>
          <button className="ide-activity-btn" onClick={logout} aria-label="Log out">
            <LucideIcons.LogOut size={20} />
          </button>
        </nav>

        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <aside className="ide-sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              {activityView === 'files' ? (
                <FileExplorer
                  project={project}
                  onSelectFile={handleSelectFile}
                  onCreateNode={handleCreateNode}
                  onRenameNode={handleRenameNode}
                  onDeleteNode={handleDeleteNode}
                />
              ) : (
                <div className="ide-modes">
                  <div className="ide-modes-header">Code Analysis</div>
                  <p className="ide-modes-hint">Runs on the active file.</p>
                  {EDITOR_MODES.map((mode) => (
                    <button
                      key={mode.key}
                      className={`ide-mode-item ${activeMode.key === mode.key ? 'active' : ''}`}
                      onClick={() => handleSelectMode(mode)}
                      title={mode.description}
                    >
                      <ModeIcon name={mode.lucideIcon} size={15}
                        color={activeMode.key === mode.key ? mode.color : '#666'} />
                      <span>{mode.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </aside>
            <div className="ide-resize-x" onMouseDown={(e) => beginDrag('sidebar', e)}
              role="separator" aria-orientation="vertical" />
          </>
        )}

        {/* Editor column — takes 100% width when AI panel is closed! */}
        <main className="ide-main">
          <EditorTabs
            openTabs={project.openTabs}
            nodes={project.nodes}
            activeFileId={project.activeFileId}
            onSelect={handleSelectFile}
            onClose={handleCloseTab}
            onCloseOthers={handleCloseOthers}
            onCloseAll={handleCloseAll}
          />

          <div className="ide-editor-area">
            {activeFile ? (
              <CodeEditor
                path={activePath}
                language={language}
                value={code}
                onChange={handleEditorChange}
                theme={darkMode ? 'vs-dark' : 'light'}
              />
            ) : (
              <div className="ide-no-file">
                <LucideIcons.FileCode size={44} strokeWidth={1.2} />
                <h3>No file open</h3>
                <p>Pick a file from the Explorer, or create a new one to get started.</p>
              </div>
            )}
          </div>

          {/* Bottom drawer (Terminal) */}
          {drawerOpen && (
            <>
              <div className="ide-resize-y" onMouseDown={(e) => beginDrag('drawer', e)}
                role="separator" aria-orientation="horizontal" />
              <section className="ide-drawer" style={{ height: drawerHeight }}>
                <div className="ide-drawer-header">
                  <span className="ide-drawer-title">
                    <LucideIcons.Terminal size={13} /> Terminal
                  </span>

                  {running && <span className="ide-tag live">running</span>}
                  {!running && lastExit?.killed && <span className="ide-tag warn">stopped</span>}
                  {!running && lastExit?.timedOut && <span className="ide-tag warn">timed out</span>}
                  {!running && lastExit?.truncated && <span className="ide-tag warn">truncated</span>}
                  {!running && lastExit && !lastExit.killed && !lastExit.timedOut && (
                    <span className={`ide-tag ${lastExit.exitCode === 0 ? 'ok' : 'err'}`}>
                      exit {lastExit.exitCode}
                    </span>
                  )}
                  {!socketReady && <span className="ide-tag err">disconnected</span>}

                  <span className="ide-drawer-hint">
                    type to send input · Ctrl+C stop · Ctrl+D EOF
                  </span>

                  <button className="ide-drawer-close" onClick={() => setDrawerOpen(false)}
                    title="Close panel" aria-label="Close panel">
                    <LucideIcons.X size={14} />
                  </button>
                </div>

                <div className="ide-drawer-body">
                  <Terminal
                    socketRef={socketRef}
                    socketReady={socketReady}
                    darkMode={darkMode}
                    isRunning={running}
                    onKill={handleKill}
                  />
                </div>
              </section>
            </>
          )}
        </main>

        {/* AI Assistant Panel — Only renders when open, giving full width to editor otherwise! */}
        {aiPanelOpen && (
          <>
            <div className="ide-resize-x" onMouseDown={(e) => beginDrag('ai', e)}
              role="separator" aria-orientation="vertical" />
            <aside className="ide-ai" style={{ width: aiPanelWidth, minWidth: aiPanelWidth }}>
              <div className="ide-ai-header">
                <LucideIcons.Sparkles size={14} color="#9B40E0" />
                <span className="ide-ai-title">AI Assistant</span>
                {activeFile && (
                  <span className="ide-ai-scope" title={`Operating on ${activeFile.name}`}>
                    {activeFile.name}
                  </span>
                )}
                <button
                  type="button"
                  className="ide-icon-btn ide-ai-close-btn"
                  onClick={() => setAiPanelOpen(false)}
                  title="Close AI Assistant"
                >
                  <LucideIcons.X size={13} />
                </button>
              </div>

              {/* Quick Actions Bar for Active File */}
              <div className="ide-ai-quick-bar">
                <button
                  type="button"
                  className="ide-ai-quick-btn"
                  onClick={() => runQuickAction('explain')}
                  disabled={aiLoading || !activeFile}
                  title="Explain current active file"
                >
                  <LucideIcons.BookOpen size={11} color="#58a6ff" /> Explain
                </button>
                <button
                  type="button"
                  className="ide-ai-quick-btn"
                  onClick={() => runQuickAction('debug')}
                  disabled={aiLoading || !activeFile}
                  title="Find bugs in current active file"
                >
                  <LucideIcons.Bug size={11} color="#f778ba" /> Debug
                </button>
                <button
                  type="button"
                  className="ide-ai-quick-btn"
                  onClick={() => runQuickAction('refactor')}
                  disabled={aiLoading || !activeFile}
                  title="Refactor current active file"
                >
                  <LucideIcons.RefreshCw size={11} color="#39d353" /> Refactor
                </button>
                <button
                  type="button"
                  className="ide-ai-quick-btn"
                  onClick={() => runQuickAction('complexity')}
                  disabled={aiLoading || !activeFile}
                  title="Big-O Complexity analysis"
                >
                  <LucideIcons.Timer size={11} color="#d29922" /> Big-O
                </button>
              </div>

              <div className="ide-ai-body">
                {messages.length > 0 ? (
                  <div className="ide-ai-messages">
                    {messages.map((m, i) => (
                      <div key={i} className={`ide-msg ${m.role}`}>
                        {m.role === 'model'
                          ? <ReactMarkdown>{m.content || '…'}</ReactMarkdown>
                          : <span>{m.content}</span>}
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                ) : (
                  <div className="ide-ai-empty">
                    <div className="ide-ai-empty-icon">
                      <LucideIcons.Sparkles size={24} color="#9B40E0" />
                    </div>
                    <p>
                      Ask questions about <strong>{activeFile ? activeFile.name : 'your project'}</strong> or click a quick action above.
                    </p>
                  </div>
                )}
              </div>

              <div className="ide-ai-input">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                  placeholder={activeFile ? `Ask about ${activeFile.name}…` : 'Ask about your code…'}
                  disabled={aiLoading}
                />
                <button onClick={handleSendMessage} disabled={aiLoading || !chatInput.trim()}
                  title="Send" aria-label="Send">
                  {aiLoading
                    ? <LucideIcons.Loader2 size={15} className="ide-spin" />
                    : <LucideIcons.Send size={15} />}
                </button>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ── STATUS BAR ── */}
      <footer className="ide-statusbar">
        <span className="ide-status-left">
          <LucideIcons.FolderTree size={11} />
          {projectName}
          <span className="ide-status-sep">·</span>
          {Object.values(project.nodes).filter((n) => n.type === 'file').length} files
        </span>
        <span className="ide-status-right">
          {activePath && <span title={activePath}>{activePath}</span>}
          <span className="ide-status-sep">·</span>
          <span>Entry: {projectEntryPoint || 'None'}</span>
          <span className="ide-status-sep">·</span>
          <span>Target: {LANG_LABEL[runLanguage] || runLanguage}</span>
        </span>
      </footer>
    </div>
  );
}

export default IDE;

import Editor from '@monaco-editor/react';

/**
 * Monaco wrapper.
 *
 * `path` is optional. When provided, Monaco keeps a separate model per path,
 * which gives each file its own undo history and restores scroll/cursor when
 * switching tabs. Existing callers (Interview, FormalInterview, Workspace) omit
 * it and behave exactly as before.
 */
function CodeEditor({
  language,
  value,
  onChange,
  theme = 'vs-dark',
  path,
  readOnly = false,
  options: extraOptions,
}) {
  const handleChange = (newValue) => {
    onChange?.(newValue || '');
  };

  return (
    <Editor
      height="100%"
      {...(path ? { path } : {})}
      language={language}
      value={value}
      onChange={handleChange}
      theme={theme}
      // Preserve per-file view state (scroll/cursor) across tab switches.
      keepCurrentModel
      saveViewState
      loading={<div style={{ color: '#666', fontSize: '0.8rem', padding: '1rem' }}>Loading editor…</div>}
      options={{
        fontSize: 14,
        fontFamily: "'Fira Code', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        lineNumbers: 'on',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 16 },
        suggestOnTriggerCharacters: true,
        tabSize: 2,
        renderLineHighlight: 'all',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        readOnly,
        bracketPairColorization: { enabled: true },
        ...extraOptions,
      }}
    />
  );
}

export default CodeEditor;

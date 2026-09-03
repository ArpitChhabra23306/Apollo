import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  purple: '\x1b[35m',
};

const THEMES = {
  dark: {
    background: '#0A0A0A',
    foreground: '#d4d4d4',
    cursor: '#9B40E0',
    cursorAccent: '#0A0A0A',
    selectionBackground: 'rgba(155, 64, 224, 0.3)',
    black: '#0A0A0A', red: '#ff8580', green: '#22c55e', yellow: '#eab308',
    blue: '#58a6ff', magenta: '#c9a5f0', cyan: '#4bccff', white: '#d4d4d4',
  },
  light: {
    background: '#FFFFFF',
    foreground: '#1A1A1A',
    cursor: '#7B2FBE',
    cursorAccent: '#FFFFFF',
    selectionBackground: 'rgba(123, 47, 190, 0.2)',
    black: '#1A1A1A', red: '#d1242f', green: '#1a7f37', yellow: '#9a6700',
    blue: '#0969da', magenta: '#7B2FBE', cyan: '#1b7c83', white: '#f5f5f7',
  },
};

/**
 * Streaming terminal panel.
 *
 * Displays live program output and forwards keystrokes to the running process's
 * stdin. It is NOT a shell — typed text is never executed as a command. When no
 * process is running, input is discarded and the user is told so.
 */
function Terminal({ socketRef, socketReady, darkMode, isRunning, onKill }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  // Read inside socket handlers without re-subscribing on every render.
  const runningRef = useRef(isRunning);
  const lineBufferRef = useRef('');

  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  /* ── Create the terminal once ── */
  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      fontSize: 12.5,
      fontFamily: "'Fira Code', 'Cascadia Mono', Consolas, monospace",
      cursorBlink: true,
      convertEol: true,        // treat \n as \r\n; child output rarely sends \r
      scrollback: 5000,
      theme: THEMES[darkMode ? 'dark' : 'light'],
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);

    termRef.current = term;
    fitRef.current = fit;

    try { fit.fit(); } catch { /* host not measured yet */ }

    term.writeln(`${ANSI.dim}Apollo terminal — program output appears here.${ANSI.reset}`);
    term.writeln(`${ANSI.dim}This is not a shell; typing sends input to a running program.${ANSI.reset}`);

    return () => {
      term.dispose();          // xterm leaks DOM/listeners without this
      termRef.current = null;
      fitRef.current = null;
    };
    // Intentionally created once; theme changes are applied in a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Keep it fitted to the resizable drawer ── */
  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch { /* mid-layout */ }
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  /* ── Theme changes ── */
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = THEMES[darkMode ? 'dark' : 'light'];
    }
  }, [darkMode]);

  /* ── Forward keystrokes to the running program's stdin ── */
  useEffect(() => {
    const term = termRef.current;
    const socket = socketRef.current;
    if (!term || !socket) return;

    const disposable = term.onData((data) => {
      // Ctrl+C — ask the server to stop the process.
      if (data === '\x03') {
        if (runningRef.current) {
          term.write(`${ANSI.yellow}^C${ANSI.reset}\r\n`);
          onKill?.();
        }
        return;
      }

      // Ctrl+D — signal EOF to a program blocked on input.
      if (data === '\x04') {
        if (runningRef.current) {
          socketRef.current?.emit('project:stdin-end');
          term.write(`${ANSI.dim}^D${ANSI.reset}\r\n`);
        }
        return;
      }

      if (!runningRef.current) {
        term.write(`\r\n${ANSI.dim}(no program running — press Run to start one)${ANSI.reset}\r\n`);
        lineBufferRef.current = '';
        return;
      }

      // Backspace
      if (data === '\x7f') {
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      // Enter — commit the line to the child's stdin.
      if (data === '\r') {
        term.write('\r\n');
        socketRef.current?.emit('project:stdin', { data: lineBufferRef.current + '\n' });
        lineBufferRef.current = '';
        return;
      }

      // Printable input: echo locally, since the child won't echo it back.
      // eslint-disable-next-line no-control-regex
      if (!/[\u0000-\u001f]/.test(data)) {
        lineBufferRef.current += data;
        term.write(data);
      }
    });

    return () => disposable.dispose();
  }, [socketRef, socketReady, onKill]);

  /* ── Socket -> terminal ── */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onStarted = ({ entry, command, language }) => {
      const term = termRef.current;
      if (!term) return;
      lineBufferRef.current = '';
      term.write('\r\n');
      term.writeln(`${ANSI.purple}$ ${command || `run ${entry}`}${ANSI.reset}${ANSI.dim}  (${language})${ANSI.reset}`);
    };

    const onOutput = ({ stream, chunk }) => {
      const term = termRef.current;
      if (!term) return;
      term.write(stream === 'stderr' ? `${ANSI.red}${chunk}${ANSI.reset}` : chunk);
    };

    const onExit = ({ exitCode, timedOut, truncated, killed }) => {
      const term = termRef.current;
      if (!term) return;
      lineBufferRef.current = '';

      let msg;
      if (killed) msg = `${ANSI.yellow}[stopped]${ANSI.reset}`;
      else if (timedOut) msg = `${ANSI.yellow}[timed out]${ANSI.reset}`;
      else if (exitCode === 0) msg = `${ANSI.green}[finished — exit 0]${ANSI.reset}`;
      else msg = `${ANSI.red}[exited with code ${exitCode}]${ANSI.reset}`;

      term.write('\r\n');
      term.writeln(msg + (truncated ? ` ${ANSI.yellow}(output truncated)${ANSI.reset}` : ''));
    };

    const onErr = ({ message }) => {
      const term = termRef.current;
      if (!term) return;
      term.write('\r\n');
      term.writeln(`${ANSI.red}Error: ${message}${ANSI.reset}`);
    };

    socket.on('project:started', onStarted);
    socket.on('project:output', onOutput);
    socket.on('project:exit', onExit);
    socket.on('project:error', onErr);

    return () => {
      socket.off('project:started', onStarted);
      socket.off('project:output', onOutput);
      socket.off('project:exit', onExit);
      socket.off('project:error', onErr);
    };
  }, [socketRef, socketReady]);

  return <div className="term-host" ref={hostRef} />;
}

export default Terminal;

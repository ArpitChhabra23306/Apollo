/**
 * Apollo — Terminal sockets
 *
 * Streams project execution to the IDE's terminal panel as it happens.
 *
 * THIS IS NOT A SHELL. Read before changing anything here.
 *
 * The only privileged operation is `project:run`, whose command is authored
 * entirely server-side by projectRunner.buildSteps(). Text arriving on
 * `project:stdin` is written *only* to the stdin of an already-running child
 * process — it is never parsed, never resolved against PATH, never eval'd.
 *
 * If a future change makes typed text execute as commands, that reintroduces
 * full remote code execution and needs a fresh security review, not a patch.
 */

import { runProjectStreaming } from '../services/projectRunner.js';
import { killTree } from '../services/execSafe.js';
import { cleanupSession } from '../services/projectRunner.js';

// socketId -> { child, killed }
const sessions = new Map();

export default function initTerminalSockets(io) {
  io.on('connection', (socket) => {
    const stop = (reason) => {
      const session = sessions.get(socket.id);
      if (!session) return false;
      session.killed = true;
      if (session.child) killTree(session.child);
      sessions.delete(socket.id);
      if (reason) console.log(`[terminal] ${socket.id}: killed (${reason})`);
      return true;
    };

    socket.on('project:run', async (payload = {}) => {
      // One run per socket. A new run supersedes the old one so output can't interleave.
      if (sessions.has(socket.id)) stop('superseded by new run');

      const { files, language, entry, stdin } = payload;
      const session = { child: null, killed: false };
      sessions.set(socket.id, session);

      try {
        await runProjectStreaming(
          { files, language, entry, stdin: stdin || '', interactive: true },
          {
            onStart: (info) => socket.emit('project:started', info),
            onOutput: ({ stream, chunk }) => socket.emit('project:output', { stream, chunk }),
            onError: ({ message }) => socket.emit('project:error', { message }),
            onSpawn: (child) => { session.child = child; },
            onExit: (summary) => socket.emit('project:exit', {
              ...summary,
              killed: session.killed,
            }),
          }
        );
      } catch (err) {
        socket.emit('project:error', { message: err.message });
      } finally {
        sessions.delete(socket.id);
      }
    });

    // Forwarded verbatim to the child's stdin. Not interpreted.
    socket.on('project:stdin', ({ data } = {}) => {
      const session = sessions.get(socket.id);
      if (!session?.child?.stdin || typeof data !== 'string') return;
      try {
        session.child.stdin.write(data);
      } catch { /* child may have exited mid-write */ }
    });

    // Signals EOF to a program blocked on input (Ctrl+D equivalent).
    socket.on('project:stdin-end', () => {
      const session = sessions.get(socket.id);
      if (!session?.child?.stdin) return;
      try { session.child.stdin.end(); } catch { /* already closed */ }
    });

    socket.on('project:kill', () => {
      if (stop('user requested')) {
        socket.emit('project:output', { stream: 'stderr', chunk: '\n[stopped]\n' });
        socket.emit('project:exit', { exitCode: -1, timedOut: false, truncated: false, killed: true });
      }
    });

    // Critical: without this, closing the tab mid-run orphans the process and
    // leaks its sandbox directory.
    socket.on('disconnect', () => {
      stop('socket disconnected');
    });
  });
}

/** Kills every live run — used on graceful server shutdown. */
export async function shutdownTerminalSessions() {
  for (const [id, session] of sessions.entries()) {
    session.killed = true;
    if (session.child) killTree(session.child);
    if (session.sessionDir) await cleanupSession(session.sessionDir);
    sessions.delete(id);
  }
}

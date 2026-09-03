import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

import aiRoutes from './routes/aiRoutes.js';
import codeRoutes from './routes/codeRoutes.js';
import authRoutes from './routes/authRoutes.js';
import connectDB from './config/db.js';
import initInterviewSockets from './sockets/interviewSockets.js';
import initTerminalSockets, { shutdownTerminalSessions } from './sockets/terminalSockets.js';
import { sweepOrphanedSessions } from './services/projectRunner.js';
import { detectToolchain, formatToolchainReport } from './services/toolchain.js';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
connectDB();

/**
 * Allowed browser origins.
 *
 * This server can now execute code, so a wildcard origin would let any website
 * open a socket and trigger runs. Set CLIENT_ORIGINS (comma-separated) in .env
 * to lock this down in production.
 */
const DEV_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173', // vite dev
  'http://localhost:4173', 'http://127.0.0.1:4173', // vite preview
  'http://localhost:3000', 'http://127.0.0.1:3000',
];

const configuredOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...DEV_ORIGINS, ...configuredOrigins])];

// Falling back to permissive only when nothing is configured, so we improve the
// default without silently breaking an existing deployment.
const allowAnyOrigin = configuredOrigins.length === 0;

if (allowAnyOrigin) {
  console.warn(
    '[cors] CLIENT_ORIGINS is not set — accepting requests from any origin.\n' +
    '       Set CLIENT_ORIGINS in .env before exposing code execution publicly.'
  );
}

const corsOrigin = (origin, callback) => {
  // Same-origin / non-browser callers (curl, server-to-server) send no Origin.
  if (!origin) return callback(null, true);
  if (allowAnyOrigin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error(`Origin not allowed by CORS: ${origin}`));
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 2e6, // 2MB — project payloads are capped at 1MB of source
});
const PORT = process.env.PORT || 5000;

// ── Middleware ──
app.use(cors({ origin: corsOrigin }));
// Project payloads carry the whole file tree, so the default 100kb is too small.
app.use(express.json({ limit: '2mb' }));

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/code', codeRoutes);

// ── Health Check ──
// Reports toolchain availability so the client can annotate unsupported languages.
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    message: 'Apollo Backend is running',
    toolchain: await detectToolchain(),
  });
});

// Initialize WebSockets
initInterviewSockets(io);
initTerminalSockets(io);

// ── Start Server ──
httpServer.listen(PORT, async () => {
  console.log(`Apollo server running on port ${PORT}`);

  // Clean up sandbox dirs orphaned by a previous crash or hard restart.
  await sweepOrphanedSessions();

  // Probe compilers/interpreters once, so a misconfigured host is obvious now
  // rather than when a user hits Run.
  const toolchain = await detectToolchain();
  console.log(formatToolchainReport(toolchain));
});

// ── Graceful shutdown ──
const shutdown = async (signal) => {
  console.log(`\n[server] ${signal} received — shutting down.`);
  await shutdownTerminalSessions();
  httpServer.close(() => process.exit(0));
  // Don't hang forever if sockets refuse to close.
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

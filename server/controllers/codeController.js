import { executeCode } from '../services/codeRunner.js';
import { runProject } from '../services/projectRunner.js';

/**
 * POST /api/code/run
 * Executes a single snippet. Used by the classic Workspace, the AI test
 * generator, and the interview pages.
 */
export async function runCode(req, res) {
  const { code, language, stdin } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  try {
    const result = await executeCode(code, language, stdin || '');
    res.json(result);
  } catch (error) {
    console.error('Error in runCode:', error);
    res.status(500).json({ error: 'Code execution failed', details: error.message });
  }
}

/**
 * POST /api/code/run-project
 * Executes a whole multi-file project so cross-file imports resolve.
 *
 * Body: { files: [{ path, content }], language, entry?, stdin?, action? }
 */
export async function runProjectHandler(req, res) {
  const { files, language, entry, stdin, action = 'run' } = req.body;

  if (action === 'install') {
    // Deliberately unimplemented: arbitrary package installs mean network
    // egress, supply-chain risk, multi-minute runs and hundreds of MB per
    // session. Revisit once container isolation exists.
    return res.status(501).json({
      error: 'Dependency installation is not supported yet',
      details: 'Projects are limited to each language\'s standard library for now.',
    });
  }

  if (action !== 'run') {
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files must be a non-empty array' });
  }

  if (!language) {
    return res.status(400).json({ error: 'language is required' });
  }

  try {
    const result = await runProject({ files, language, entry, stdin: stdin || '' });
    res.json(result);
  } catch (error) {
    const status = error.statusCode ?? 500;
    // 4xx are user-correctable (bad path, no entry point); don't log them as faults.
    if (status >= 500) console.error('Error in runProject:', error);
    res.status(status).json({
      error: status >= 500 ? 'Project execution failed' : error.message,
      details: error.message,
    });
  }
}

import { Router } from 'express';
import { runCode, runProjectHandler } from '../controllers/codeController.js';

const router = Router();

// POST /api/code/run — execute a single snippet
router.post('/run', runCode);

// POST /api/code/run-project — execute a multi-file project
router.post('/run-project', runProjectHandler);

export default router;

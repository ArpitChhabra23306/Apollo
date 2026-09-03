import { Router } from 'express';
import { generateDuelProblem } from '../services/duelAIService.js';
import { evaluateDuelSubmission } from '../services/duelRunner.js';

const router = Router();

/**
 * POST /api/duel/generate-problem
 * Generates an AI DSA problem based on prompt or difficulty preset.
 */
router.post('/generate-problem', async (req, res) => {
  try {
    const { prompt, difficulty, topic } = req.body;
    const problem = await generateDuelProblem({ prompt, difficulty, topic });
    res.json({ success: true, problem });
  } catch (error) {
    console.error('[Duel] Error generating problem:', error);
    res.status(500).json({ success: false, error: 'Failed to generate problem', details: error.message });
  }
});

/**
 * POST /api/duel/evaluate
 * Fallback HTTP endpoint to evaluate candidate code.
 */
router.post('/evaluate', async (req, res) => {
  try {
    const { code, language, problem, sampleOnly } = req.body;
    const result = await evaluateDuelSubmission({ code, language, problem, sampleOnly });
    res.json(result);
  } catch (error) {
    console.error('[Duel] Error evaluating code:', error);
    res.status(500).json({ ok: false, error: 'Evaluation failed', details: error.message });
  }
});

export default router;

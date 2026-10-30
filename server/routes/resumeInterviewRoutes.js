import { Router } from 'express';
import multer from 'multer';
import {
  uploadResumeAndGenerate,
  analyzeGitHubAndGenerate,
  generateCustomQuestions,
} from '../controllers/resumeInterviewController.js';

const router = Router();

// Configure Multer for in-memory uploads up to 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/resume-interview/upload-resume
router.post('/upload-resume', upload.single('resume'), uploadResumeAndGenerate);

// POST /api/resume-interview/github-repo
router.post('/github-repo', analyzeGitHubAndGenerate);

// POST /api/resume-interview/custom-questions
router.post('/custom-questions', generateCustomQuestions);

export default router;

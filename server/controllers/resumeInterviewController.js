import path from 'path';
import {
  extractPdfText,
  fetchGitHubRepoDetails,
  analyzeAndGenerateInterview,
} from '../services/resumeInterviewService.js';

/**
 * POST /api/resume-interview/upload-resume
 * Accepts multipart/form-data with resume file (PDF, TXT, MD)
 */
export async function uploadResumeAndGenerate(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select and upload a resume file (PDF, TXT, or MD).' });
    }

    const { originalname, buffer, mimetype } = req.file;
    const ext = path.extname(originalname).toLowerCase().replace('.', '') || 'pdf';

    let rawText = '';
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      rawText = await extractPdfText(buffer);
    } else {
      rawText = buffer.toString('utf-8');
    }

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({
        error: 'Could not extract text from the uploaded resume. Please verify the file is not an empty or scanned image-only PDF.',
      });
    }

    const {
      role = 'Software Engineer',
      experienceLevel = 'Mid-Level',
      focusCategory = 'all',
      difficulty = 'Medium',
    } = req.body;

    const data = await analyzeAndGenerateInterview({
      resumeText: rawText,
      role,
      experienceLevel,
      focusCategory,
      difficulty,
    });

    return res.status(200).json({
      success: true,
      message: `Resume "${originalname}" analyzed successfully. Generated ${data.questions?.length || 0} technical questions.`,
      data,
    });
  } catch (error) {
    console.error('[resumeInterviewController] Error handling resume upload:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process resume and generate interview questions.',
    });
  }
}

/**
 * POST /api/resume-interview/github-repo
 * Accepts JSON with { repoUrl, role, experienceLevel, focusCategory, difficulty }
 */
export async function analyzeGitHubAndGenerate(req, res) {
  try {
    const {
      repoUrl,
      role = 'Software Engineer',
      experienceLevel = 'Mid-Level',
      focusCategory = 'all',
      difficulty = 'Medium',
    } = req.body;

    if (!repoUrl || typeof repoUrl !== 'string' || !repoUrl.trim()) {
      return res.status(400).json({ error: 'Please provide a valid GitHub repository URL (e.g., https://github.com/owner/repo).' });
    }

    const githubData = await fetchGitHubRepoDetails(repoUrl);

    const data = await analyzeAndGenerateInterview({
      githubData,
      role,
      experienceLevel,
      focusCategory,
      difficulty,
    });

    return res.status(200).json({
      success: true,
      message: `GitHub repository "${githubData.fullName}" analyzed successfully. Generated ${data.questions?.length || 0} technical questions.`,
      data,
    });
  } catch (error) {
    console.error('[resumeInterviewController] Error analyzing GitHub repo:', error);
    return res.status(500).json({
      error: error.message || 'Failed to analyze GitHub repository.',
    });
  }
}

/**
 * POST /api/resume-interview/custom-questions
 * Generates additional tailored questions for existing candidate context
 */
export async function generateCustomQuestions(req, res) {
  try {
    const {
      projects = [],
      candidate = null,
      focusCategory = 'all',
      difficulty = 'Medium',
      role = 'Software Engineer',
    } = req.body;

    const summaryContext = `Projects: ${JSON.stringify(projects)}\nCandidate Tech Stack: ${JSON.stringify(candidate?.techStack || {})}`;
    const data = await analyzeAndGenerateInterview({
      resumeText: summaryContext,
      role,
      experienceLevel: candidate?.experienceLevel || 'Mid-Level',
      focusCategory,
      difficulty,
    });

    return res.status(200).json({
      success: true,
      questions: data.questions || [],
    });
  } catch (error) {
    console.error('[resumeInterviewController] Error generating custom questions:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate additional questions.',
    });
  }
}

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as LucideIcons from 'lucide-react';
import ImmersiveNav from '../components/ImmersiveNav';
import {
  uploadResumeForInterview,
  analyzeGitHubRepoForInterview,
  generateCustomProjectQuestions,
} from '../services/api';
import './ResumeInterviewPrep.css';

const ROLES = [
  'Full-Stack Engineer',
  'Backend & Distributed Systems',
  'Frontend & UI Architecture',
  'DevOps & Cloud Infrastructure',
  'AI / Machine Learning Engineer',
];

const EXPERIENCE_LEVELS = [
  { value: 'Junior Level (0-2 yrs)', label: 'Junior (0-2 yrs)' },
  { value: 'Mid-Level (2-5 yrs)', label: 'Mid-Level (2-5 yrs)' },
  { value: 'Senior (5-8 yrs)', label: 'Senior (5-8 yrs)' },
  { value: 'Lead / Principal (8+ yrs)', label: 'Lead / Principal (8+ yrs)' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

const FOCUS_CATEGORIES = [
  { key: 'all', label: '360° All-Round Suite', icon: 'Sparkles', desc: 'Balanced architecture, deep-dive, coding, and production debugging' },
  { key: 'architecture', label: 'System Design & Architecture', icon: 'Layers', desc: 'Scalability, microservices, databases & trade-offs' },
  { key: 'deep_dive', label: 'Deep Dive & Mechanics', icon: 'Cpu', desc: 'Concurrency, protocols, memory & internal algorithms' },
  { key: 'coding_challenge', label: 'Domain Coding Challenges', icon: 'Code2', desc: 'Practical algorithm/implementation problems inspired by your stack' },
  { key: 'troubleshooting', label: 'Production Incidents', icon: 'AlertTriangle', desc: 'Latency spikes, memory leaks, failovers & root-cause analysis' },
  { key: 'behavioral', label: 'Project Retrospective', icon: 'MessageSquare', desc: 'Technical debates, ownership, and difficult engineering tradeoffs' },
];

const SAMPLE_REPOS = [
  { name: 'Express.js', url: 'https://github.com/expressjs/express' },
  { name: 'Redux Toolkit', url: 'https://github.com/reduxjs/redux-toolkit' },
  { name: 'FastAPI', url: 'https://github.com/fastapi/fastapi' },
];

export default function ResumeInterviewPrep() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Input states
  const [activeTab, setActiveTab] = useState('resume'); // 'resume' | 'github'
  const [resumeFile, setResumeFile] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const [experienceLevel, setExperienceLevel] = useState(EXPERIENCE_LEVELS[1].value);
  const [difficulty, setDifficulty] = useState('Medium');
  const [focusCategory, setFocusCategory] = useState('all');

  // Loading & Progress states
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  // Result states
  const [interviewData, setInterviewData] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [expandedCards, setExpandedCards] = useState({});
  const [activeSection, setActiveSection] = useState({}); // { [qId]: 'intent' | 'answer' | 'followups' | 'code' }
  const [copiedCodeId, setCopiedCodeId] = useState(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // ── Handlers ──
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File size exceeds 10MB limit. Please upload a smaller file.');
        return;
      }
      setResumeFile(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File size exceeds 10MB limit.');
        return;
      }
      setResumeFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const startAnalysis = async () => {
    if (activeTab === 'resume' && !resumeFile) {
      toast.error('Please upload your resume file (PDF, TXT, or MD).');
      return;
    }
    if (activeTab === 'github' && !repoUrl.trim()) {
      toast.error('Please enter a valid GitHub repository URL.');
      return;
    }

    setLoading(true);
    setLoadingStep(1);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 1200);

    try {
      let data = null;
      if (activeTab === 'resume') {
        data = await uploadResumeForInterview({
          file: resumeFile,
          role,
          experienceLevel,
          focusCategory,
          difficulty,
        });
      } else {
        data = await analyzeGitHubRepoForInterview({
          repoUrl,
          role,
          experienceLevel,
          focusCategory,
          difficulty,
        });
      }

      clearInterval(stepInterval);
      setLoadingStep(4);
      setInterviewData(data);
      // Expand the first question card by default
      if (data?.questions?.[0]?.id) {
        setExpandedCards({ [data.questions[0].id]: true });
        setActiveSection({ [data.questions[0].id]: 'answer' });
      }
      toast.success(`Generated ${data.questions?.length || 0} tailored interview questions!`);
    } catch (err) {
      clearInterval(stepInterval);
      console.error(err);
      toast.error(err.message || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCardExpansion = (qId) => {
    setExpandedCards((prev) => ({ ...prev, [qId]: !prev[qId] }));
    if (!activeSection[qId]) {
      setActiveSection((prev) => ({ ...prev, [qId]: 'answer' }));
    }
  };

  const toggleSection = (qId, secKey, e) => {
    e.stopPropagation();
    setExpandedCards((prev) => ({ ...prev, [qId]: true }));
    setActiveSection((prev) => ({ ...prev, [qId]: prev[qId] === secKey ? null : secKey }));
  };

  const copyStarterCode = (qId, code) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(qId);
    toast.success('Code template copied to clipboard!');
    setTimeout(() => setCopiedCodeId(null), 2500);
  };

  const handleLaunchInSimulator = (question) => {
    // Store problem into session storage for IDE or Interview practice
    const interviewProblem = {
      title: question.title,
      description: `${question.question}\n\n${question.codingDetails?.problemDescription || ''}`,
      starterCode: question.codingDetails?.starterCode || '// Write your solution here\n',
      language: question.codingDetails?.language || 'javascript',
      difficulty: question.difficulty,
      fromProject: question.projectName,
    };
    try {
      sessionStorage.setItem('apollo_custom_problem', JSON.stringify(interviewProblem));
    } catch (e) {
      console.warn('Could not store to sessionStorage:', e);
    }
    toast.success('Loading question into Interview Practice Simulator...');
    navigate('/interview');
  };

  const handleExportMarkdown = () => {
    if (!interviewData) return;
    const { candidate, projects, questions, sourceType, sourceName } = interviewData;

    let md = `# Apollo Project & Resume Technical Interview Dossier\n\n`;
    md += `**Candidate Profile:** ${candidate?.name || 'Candidate'} (${candidate?.roleSummary || 'Software Engineer'}) - ${candidate?.experienceLevel || 'Mid-Level'}\n`;
    md += `**Source Analyzed:** ${sourceType === 'github' ? 'GitHub Repository' : 'Resume File'} (${sourceName})\n`;
    md += `**Generated Date:** ${new Date().toLocaleDateString()}\n\n`;

    md += `## Candidate Tech Stack\n`;
    if (candidate?.techStack) {
      if (candidate.techStack.languages?.length) md += `- **Languages:** ${candidate.techStack.languages.join(', ')}\n`;
      if (candidate.techStack.frameworks?.length) md += `- **Frameworks:** ${candidate.techStack.frameworks.join(', ')}\n`;
      if (candidate.techStack.databases?.length) md += `- **Databases:** ${candidate.techStack.databases.join(', ')}\n`;
      if (candidate.techStack.cloudAndTools?.length) md += `- **Cloud & Tools:** ${candidate.techStack.cloudAndTools.join(', ')}\n`;
    }
    md += `\n`;

    md += `## Identified Projects\n`;
    (projects || []).forEach((p, idx) => {
      md += `### ${idx + 1}. ${p.name}\n`;
      md += `${p.summary}\n`;
      if (p.techUsed?.length) md += `*Tech Stack:* ${p.techUsed.join(', ')}\n\n`;
    });

    md += `## Tailored 360° Technical Interview Questions\n\n`;
    (questions || []).forEach((q, idx) => {
      md += `### Question ${idx + 1}: ${q.title} [${q.category.toUpperCase()}] (${q.difficulty})\n`;
      md += `**Target Project:** ${q.projectName}\n\n`;
      md += `> **Question:** ${q.question}\n\n`;
      md += `**What Top Interviewers Look For:**\n${q.interviewerIntent}\n\n`;
      md += `**Model Answer & Architectural Talking Points:**\n${q.modelAnswer}\n\n`;
      if (q.probingFollowUps?.length) {
        md += `**Follow-Up Probes:**\n`;
        q.probingFollowUps.forEach((f) => {
          md += `- ${f}\n`;
        });
        md += `\n`;
      }
      if (q.codingDetails?.starterCode) {
        md += `**Starter Code Template (${q.codingDetails.language}):**\n\`\`\`${q.codingDetails.language}\n${q.codingDetails.starterCode}\n\`\`\`\n\n`;
      }
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `apollo-project-interview-${(candidate?.name || 'candidate').toLowerCase().replace(/\s+/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Interview dossier exported as Markdown!');
  };

  const handleExportJSON = () => {
    if (!interviewData) return;
    const blob = new Blob([JSON.stringify(interviewData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `apollo-interview-questions.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Interview questions exported as JSON!');
  };

  const getFilteredQuestions = () => {
    if (!interviewData?.questions) return [];
    if (activeFilter === 'all') return interviewData.questions;
    return interviewData.questions.filter((q) => q.category === activeFilter);
  };

  const getCategoryBadgeClass = (category) => {
    switch (category) {
      case 'architecture':
        return 'cat-badge-arch';
      case 'deep_dive':
        return 'cat-badge-deep';
      case 'coding_challenge':
        return 'cat-badge-code';
      case 'troubleshooting':
        return 'cat-badge-trouble';
      case 'behavioral':
        return 'cat-badge-behavioral';
      default:
        return 'cat-badge-default';
    }
  };

  const getCategoryLabel = (category) => {
    const found = FOCUS_CATEGORIES.find((c) => c.key === category);
    return found ? found.label : category;
  };

  return (
    <div className="rip-page-root">
      {/* IMMERSIVE NAV */}
      <ImmersiveNav
        title="Project & Resume Interview Studio"
        subtitle="Generate bespoke technical interview questions rooted in your real past projects"
        onExit={() => navigate('/interview')}
        actions={
          interviewData && (
            <div className="rip-nav-actions">
              <button className="rip-btn rip-btn-secondary" onClick={() => setInterviewData(null)}>
                <LucideIcons.RefreshCw size={14} /> New Analysis
              </button>
              <button className="rip-btn rip-btn-outline" onClick={handleExportMarkdown}>
                <LucideIcons.Download size={14} /> Export Markdown
              </button>
            </div>
          )
        }
      />

      <main className="rip-main-container">
        {/* VIEW 1: SETUP & INPUT CARD */}
        {!interviewData && !loading && (
          <div className="rip-setup-wrapper">
            <div className="rip-hero-section">
              <div className="rip-hero-glow" />
              <div className="rip-hero-badge">
                <LucideIcons.Sparkles size={14} />
                <span>AI Project & Resume Analysis Engine</span>
              </div>
              <h1 className="rip-hero-title">Custom Technical Interview Questions Based On Your Real Projects</h1>
              <p className="rip-hero-desc">
                Top interviewers don&apos;t just ask generic trivia — they scrutinize your past projects, architectural decisions,
                concurrency bugs, and scaling tradeoffs. Upload your resume or point to a GitHub repo to generate an authentic 360° interview suite.
              </p>
            </div>

            <div className="rip-card rip-setup-card">
              {/* Tab Selector */}
              <div className="rip-tabs-header">
                <button
                  className={`rip-tab-btn ${activeTab === 'resume' ? 'active' : ''}`}
                  onClick={() => setActiveTab('resume')}
                >
                  <LucideIcons.FileText size={18} />
                  <span>Upload Resume (PDF)</span>
                </button>
                <button
                  className={`rip-tab-btn ${activeTab === 'github' ? 'active' : ''}`}
                  onClick={() => setActiveTab('github')}
                >
                  <LucideIcons.Github size={18} />
                  <span>GitHub Repository Link</span>
                </button>
              </div>

              <div className="rip-card-body">
                {/* RESUME TAB CONTENT */}
                {activeTab === 'resume' && (
                  <div className="rip-tab-panel">
                    <label className="rip-section-label">Resume Document (PDF, TXT, MD)</label>
                    <div
                      className={`rip-dropzone ${isDragging ? 'dragging' : ''} ${resumeFile ? 'has-file' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.txt,.md"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                      />
                      {resumeFile ? (
                        <div className="rip-file-selected">
                          <div className="rip-file-icon">
                            <LucideIcons.FileCheck size={36} color="#10b981" />
                          </div>
                          <div className="rip-file-meta">
                            <span className="rip-file-name">{resumeFile.name}</span>
                            <span className="rip-file-size">{(resumeFile.size / 1024).toFixed(1)} KB</span>
                          </div>
                          <button
                            className="rip-file-remove-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setResumeFile(null);
                            }}
                          >
                            <LucideIcons.X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="rip-dropzone-prompt">
                          <LucideIcons.UploadCloud size={44} className="rip-upload-icon" />
                          <p className="rip-dropzone-main-text">Drag and drop your candidate resume here</p>
                          <p className="rip-dropzone-sub-text">or click to browse your local files (PDF up to 10MB)</p>
                          <span className="rip-pill-badge">Standard PDF parser enabled</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* GITHUB TAB CONTENT */}
                {activeTab === 'github' && (
                  <div className="rip-tab-panel">
                    <label className="rip-section-label">GitHub Repository URL</label>
                    <div className="rip-input-group">
                      <div className="rip-input-prefix">
                        <LucideIcons.Github size={18} />
                      </div>
                      <input
                        type="url"
                        className="rip-text-input"
                        placeholder="https://github.com/username/project-repository"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                      />
                      {repoUrl && (
                        <button className="rip-input-clear-btn" onClick={() => setRepoUrl('')}>
                          <LucideIcons.X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="rip-quick-samples">
                      <span className="rip-sample-label">Try a sample repository:</span>
                      {SAMPLE_REPOS.map((sample) => (
                        <button
                          key={sample.name}
                          type="button"
                          className="rip-sample-chip"
                          onClick={() => setRepoUrl(sample.url)}
                        >
                          {sample.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* INTERVIEW CUSTOMIZATION CONTROLS */}
                <div className="rip-controls-grid">
                  <div className="rip-field-group">
                    <label className="rip-field-label">Target Role</label>
                    <select className="rip-select" value={role} onChange={(e) => setRole(e.target.value)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rip-field-group">
                    <label className="rip-field-label">Experience Seniority</label>
                    <select
                      className="rip-select"
                      value={experienceLevel}
                      onChange={(e) => setExperienceLevel(e.target.value)}
                    >
                      {EXPERIENCE_LEVELS.map((lvl) => (
                        <option key={lvl.value} value={lvl.value}>
                          {lvl.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rip-field-group">
                    <label className="rip-field-label">Question Difficulty</label>
                    <div className="rip-btn-toggle-group">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`rip-toggle-btn ${difficulty === d ? 'active' : ''}`}
                          onClick={() => setDifficulty(d)}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* FOCUS CATEGORY SELECTOR */}
                <div className="rip-category-section">
                  <label className="rip-field-label">Focus Area</label>
                  <div className="rip-focus-cards-grid">
                    {FOCUS_CATEGORIES.map((cat) => {
                      const IconComp = LucideIcons[cat.icon] || LucideIcons.Sparkles;
                      const isSelected = focusCategory === cat.key;
                      return (
                        <div
                          key={cat.key}
                          className={`rip-focus-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => setFocusCategory(cat.key)}
                        >
                          <div className="rip-focus-card-header">
                            <IconComp size={18} className="rip-focus-icon" />
                            <span className="rip-focus-title">{cat.label}</span>
                          </div>
                          <p className="rip-focus-desc">{cat.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SUBMIT BUTTON */}
                <div className="rip-action-row">
                  <button className="rip-btn rip-btn-primary rip-btn-large" onClick={startAnalysis}>
                    <LucideIcons.Sparkles size={18} />
                    <span>Analyze Projects & Generate 360° Questions</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LOADING ANIMATION STATE */}
        {loading && (
          <div className="rip-loading-card">
            <div className="rip-loading-spinner-ring">
              <div className="rip-spinner-core" />
            </div>
            <h2 className="rip-loading-title">Analyzing Candidate Projects & Architecture</h2>
            <p className="rip-loading-subtitle">
              Apollo is parsing your source artifacts, identifying system boundaries, and crafting tailored technical questions.
            </p>

            <div className="rip-stepper">
              <div className={`rip-step-item ${loadingStep >= 1 ? 'completed' : 'pending'}`}>
                <div className="rip-step-circle">
                  {loadingStep > 1 ? <LucideIcons.Check size={14} /> : '1'}
                </div>
                <span>Parsing PDF text or GitHub manifests</span>
              </div>
              <div className={`rip-step-item ${loadingStep >= 2 ? 'completed' : 'pending'}`}>
                <div className="rip-step-circle">
                  {loadingStep > 2 ? <LucideIcons.Check size={14} /> : '2'}
                </div>
                <span>Extracting Tech Stack & Project Footprints</span>
              </div>
              <div className={`rip-step-item ${loadingStep >= 3 ? 'completed' : 'pending'}`}>
                <div className="rip-step-circle">
                  {loadingStep > 3 ? <LucideIcons.Check size={14} /> : '3'}
                </div>
                <span>Synthesizing Architecture & Concurrency Scenarios</span>
              </div>
              <div className={`rip-step-item ${loadingStep >= 4 ? 'completed' : 'pending'}`}>
                <div className="rip-step-circle">
                  {loadingStep >= 4 ? <LucideIcons.Check size={14} /> : '4'}
                </div>
                <span>Formulating Evaluation Rubric & Code Challenges</span>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: RESULTS WORKSPACE */}
        {interviewData && !loading && (
          <div className="rip-results-wrapper">
            {/* DOSSIER HEADER */}
            <div className="rip-dossier-card">
              <div className="rip-dossier-top">
                <div className="rip-candidate-info">
                  <div className="rip-avatar-circle">
                    <LucideIcons.UserCheck size={28} color="#9B40E0" />
                  </div>
                  <div>
                    <div className="rip-candidate-name-row">
                      <h2 className="rip-candidate-name">{interviewData.candidate?.name || 'Candidate'}</h2>
                      <span className="rip-seniority-badge">{interviewData.candidate?.experienceLevel || experienceLevel}</span>
                      <span className="rip-source-badge">
                        {interviewData.sourceType === 'github' ? (
                          <><LucideIcons.Github size={12} /> {interviewData.sourceName}</>
                        ) : (
                          <><LucideIcons.FileText size={12} /> {interviewData.sourceName}</>
                        )}
                      </span>
                    </div>
                    <p className="rip-candidate-role">{interviewData.candidate?.roleSummary || role}</p>
                  </div>
                </div>

                <div className="rip-quick-stats">
                  <div className="rip-stat-item">
                    <span className="rip-stat-number">{interviewData.questions?.length || 0}</span>
                    <span className="rip-stat-label">Questions</span>
                  </div>
                  <div className="rip-stat-item">
                    <span className="rip-stat-number">{interviewData.projects?.length || 0}</span>
                    <span className="rip-stat-label">Projects</span>
                  </div>
                  <div className="rip-stat-item">
                    <span className="rip-stat-number">
                      {interviewData.questions?.filter((q) => q.category === 'coding_challenge').length || 0}
                    </span>
                    <span className="rip-stat-label">Code Labs</span>
                  </div>
                </div>
              </div>

              {/* DETECTED TECH STACK */}
              <div className="rip-tech-grid">
                {interviewData.candidate?.techStack?.languages?.length > 0 && (
                  <div className="rip-tech-col">
                    <span className="rip-tech-group-title">Languages</span>
                    <div className="rip-tech-tags">
                      {interviewData.candidate.techStack.languages.map((l) => (
                        <span key={l} className="rip-tech-chip chip-lang">
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {interviewData.candidate?.techStack?.frameworks?.length > 0 && (
                  <div className="rip-tech-col">
                    <span className="rip-tech-group-title">Frameworks</span>
                    <div className="rip-tech-tags">
                      {interviewData.candidate.techStack.frameworks.map((f) => (
                        <span key={f} className="rip-tech-chip chip-framework">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {interviewData.candidate?.techStack?.databases?.length > 0 && (
                  <div className="rip-tech-col">
                    <span className="rip-tech-group-title">Databases</span>
                    <div className="rip-tech-tags">
                      {interviewData.candidate.techStack.databases.map((d) => (
                        <span key={d} className="rip-tech-chip chip-db">
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {interviewData.candidate?.techStack?.cloudAndTools?.length > 0 && (
                  <div className="rip-tech-col">
                    <span className="rip-tech-group-title">Cloud & Infrastructure</span>
                    <div className="rip-tech-tags">
                      {interviewData.candidate.techStack.cloudAndTools.map((t) => (
                        <span key={t} className="rip-tech-chip chip-tool">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* IDENTIFIED PROJECTS STRIP */}
              {interviewData.projects?.length > 0 && (
                <div className="rip-projects-strip">
                  <div className="rip-projects-strip-title">
                    <LucideIcons.FolderGit2 size={15} /> Identified Projects
                  </div>
                  <div className="rip-projects-list">
                    {interviewData.projects.map((proj) => (
                      <div key={proj.id || proj.name} className="rip-project-box">
                        <div className="rip-project-name">{proj.name}</div>
                        <div className="rip-project-desc">{proj.summary}</div>
                        {proj.techUsed?.length > 0 && (
                          <div className="rip-project-tech-line">
                            {proj.techUsed.slice(0, 4).map((t) => (
                              <span key={t} className="rip-mini-tag">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* FILTER BAR */}
            <div className="rip-filter-bar">
              <div className="rip-filter-pills">
                <button
                  className={`rip-filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  All ({interviewData.questions?.length || 0})
                </button>
                {FOCUS_CATEGORIES.filter((c) => c.key !== 'all').map((cat) => {
                  const count = interviewData.questions?.filter((q) => q.category === cat.key).length || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat.key}
                      className={`rip-filter-pill ${activeFilter === cat.key ? 'active' : ''}`}
                      onClick={() => setActiveFilter(cat.key)}
                    >
                      {cat.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="rip-filter-actions">
                <button className="rip-filter-btn" onClick={handleExportMarkdown} title="Export as Markdown">
                  <LucideIcons.FileDown size={15} /> Markdown
                </button>
                <button className="rip-filter-btn" onClick={handleExportJSON} title="Export as JSON">
                  <LucideIcons.Code2 size={15} /> JSON
                </button>
              </div>
            </div>

            {/* QUESTIONS LIST */}
            <div className="rip-questions-list">
              {getFilteredQuestions().map((q, idx) => {
                const isExpanded = expandedCards[q.id];
                const activeSec = activeSection[q.id] || 'answer';

                return (
                  <div key={q.id || idx} className={`rip-question-card ${isExpanded ? 'expanded' : ''}`}>
                    {/* CARD HEADER */}
                    <div className="rip-qcard-header" onClick={() => toggleCardExpansion(q.id)}>
                      <div className="rip-qcard-badges">
                        <span className={`rip-qbadge ${getCategoryBadgeClass(q.category)}`}>
                          {getCategoryLabel(q.category)}
                        </span>
                        <span className="rip-qbadge-project">
                          <LucideIcons.Folder size={11} /> {q.projectName}
                        </span>
                        <span className={`rip-qbadge-diff diff-${(q.difficulty || 'medium').toLowerCase()}`}>
                          {q.difficulty}
                        </span>
                      </div>

                      <h3 className="rip-qcard-title">{q.title}</h3>
                      <p className="rip-qcard-prompt">{q.question}</p>

                      <div className="rip-qcard-toggle-row">
                        <div className="rip-qcard-tabs" onClick={(e) => e.stopPropagation()}>
                          <button
                            className={`rip-qtab ${activeSec === 'answer' ? 'active' : ''}`}
                            onClick={(e) => toggleSection(q.id, 'answer', e)}
                          >
                            <LucideIcons.BookOpen size={13} /> Model Strategy & Answer
                          </button>
                          <button
                            className={`rip-qtab ${activeSec === 'intent' ? 'active' : ''}`}
                            onClick={(e) => toggleSection(q.id, 'intent', e)}
                          >
                            <LucideIcons.Target size={13} /> Evaluator Intent
                          </button>
                          {q.probingFollowUps?.length > 0 && (
                            <button
                              className={`rip-qtab ${activeSec === 'followups' ? 'active' : ''}`}
                              onClick={(e) => toggleSection(q.id, 'followups', e)}
                            >
                              <LucideIcons.HelpCircle size={13} /> Follow-Up Probes ({q.probingFollowUps.length})
                            </button>
                          )}
                          {q.codingDetails?.starterCode && (
                            <button
                              className={`rip-qtab ${activeSec === 'code' ? 'active' : ''}`}
                              onClick={(e) => toggleSection(q.id, 'code', e)}
                            >
                              <LucideIcons.Terminal size={13} /> Code Challenge
                            </button>
                          )}
                        </div>

                        <button className="rip-qcard-expand-icon" title="Toggle card">
                          {isExpanded ? <LucideIcons.ChevronUp size={18} /> : <LucideIcons.ChevronDown size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* EXPANDABLE BODY */}
                    {isExpanded && (
                      <div className="rip-qcard-body">
                        {/* SECTION: MODEL STRATEGY */}
                        {activeSec === 'answer' && (
                          <div className="rip-qcontent-section">
                            <div className="rip-qcontent-header">
                              <LucideIcons.CheckCircle2 size={16} color="#10b981" />
                              <span>Model Answer & Architectural Talking Points</span>
                            </div>
                            <div className="rip-qcontent-text">
                              {q.modelAnswer.split('\n').map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* SECTION: EVALUATOR INTENT */}
                        {activeSec === 'intent' && (
                          <div className="rip-qcontent-section">
                            <div className="rip-qcontent-header">
                              <LucideIcons.Compass size={16} color="#8b5cf6" />
                              <span>What Top Interviewers Evaluate (Rubric Signals)</span>
                            </div>
                            <div className="rip-qcontent-text">
                              <p>{q.interviewerIntent}</p>
                            </div>
                          </div>
                        )}

                        {/* SECTION: FOLLOW-UP PROBES */}
                        {activeSec === 'followups' && q.probingFollowUps?.length > 0 && (
                          <div className="rip-qcontent-section">
                            <div className="rip-qcontent-header">
                              <LucideIcons.MessageSquare size={16} color="#f59e0b" />
                              <span>Realistic Probing Follow-Up Questions</span>
                            </div>
                            <ul className="rip-probes-list">
                              {q.probingFollowUps.map((probe, pIdx) => (
                                <li key={pIdx} className="rip-probe-item">
                                  <LucideIcons.ArrowRight size={14} className="rip-probe-bullet" />
                                  <span>{probe}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* SECTION: CODING DETAILS */}
                        {activeSec === 'code' && q.codingDetails && (
                          <div className="rip-qcontent-section rip-coding-lab-section">
                            <div className="rip-qcontent-header">
                              <LucideIcons.Code2 size={16} color="#06b6d4" />
                              <span>Domain Coding Challenge & Starter Template</span>
                              <div className="rip-coding-actions">
                                <button
                                  className="rip-mini-btn"
                                  onClick={() => copyStarterCode(q.id, q.codingDetails.starterCode)}
                                >
                                  {copiedCodeId === q.id ? (
                                    <><LucideIcons.Check size={12} /> Copied</>
                                  ) : (
                                    <><LucideIcons.Copy size={12} /> Copy Code</>
                                  )}
                                </button>
                                <button
                                  className="rip-mini-btn rip-btn-highlight"
                                  onClick={() => handleLaunchInSimulator(q)}
                                >
                                  <LucideIcons.Play size={12} /> Launch in Interview Simulator
                                </button>
                              </div>
                            </div>

                            {q.codingDetails.problemDescription && (
                              <div className="rip-code-problem-desc">
                                {q.codingDetails.problemDescription}
                              </div>
                            )}

                            {q.codingDetails.exampleInput && (
                              <div className="rip-code-io-grid">
                                <div className="rip-io-box">
                                  <span className="rip-io-label">Sample Input</span>
                                  <code>{q.codingDetails.exampleInput}</code>
                                </div>
                                <div className="rip-io-box">
                                  <span className="rip-io-label">Expected Output</span>
                                  <code>{q.codingDetails.exampleOutput}</code>
                                </div>
                              </div>
                            )}

                            {q.codingDetails.constraints?.length > 0 && (
                              <div className="rip-constraints-box">
                                <span className="rip-constraints-title">Constraints:</span>
                                <ul>
                                  {q.codingDetails.constraints.map((c, ci) => (
                                    <li key={ci}>{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="rip-code-snippet-box">
                              <div className="rip-code-snippet-bar">
                                <span>{q.codingDetails.language || 'javascript'}</span>
                              </div>
                              <pre className="rip-code-pre">
                                <code>{q.codingDetails.starterCode}</code>
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* BOTTOM RE-ANALYSIS / ACTION BAR */}
            <div className="rip-bottom-card">
              <div className="rip-bottom-left">
                <h4>Ready to test your answers in a real-time proctored mock interview?</h4>
                <p>Transfer these custom questions into the full-screen simulator with timer, code execution, and tab-switch integrity monitoring.</p>
              </div>
              <div className="rip-bottom-right">
                <button
                  className="rip-btn rip-btn-primary"
                  onClick={() => navigate('/interview')}
                >
                  <LucideIcons.Play size={16} /> Open Interview Simulator
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

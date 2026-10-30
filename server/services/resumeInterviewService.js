import { PDFParse } from 'pdf-parse';
import openai from '../config/ai.js';

const MODEL = 'gpt-4o-mini';

/**
 * Extracts raw text from a PDF buffer using pdf-parse v2
 */
export async function extractPdfText(buffer) {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch {
        // ignore destroy errors
      }
    }
    return (result && result.text) ? result.text.trim() : '';
  } catch (err) {
    console.error('[resumeInterviewService] PDF parsing failed:', err.message);
    throw new Error(`Failed to parse PDF: ${err.message}`);
  }
}

/**
 * Parses GitHub owner and repo from various URL formats
 */
export function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = clean.match(/(?:github\.com\/|^)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Fetches repository metadata, README, languages, and package manifests via GitHub REST API
 */
export async function fetchGitHubRepoDetails(repoUrl) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL. Expected format: https://github.com/owner/repository');
  }

  const { owner, repo } = parsed;
  const headers = {
    'User-Agent': 'Apollo-Project-Interview-Prep',
    'Accept': 'application/vnd.github.v3+json',
  };

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  // 1. Fetch repo metadata
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`GitHub repository "${owner}/${repo}" not found or is private.`);
    }
    if (repoRes.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Please try again in a few minutes or provide another repo.');
    }
    throw new Error(`GitHub API error (${repoRes.status}): ${repoRes.statusText}`);
  }
  const repoData = await repoRes.json();

  // 2. Fetch README (optional)
  let readmeText = '';
  try {
    const readmeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
    if (readmeRes.ok) {
      const readmeJson = await readmeRes.json();
      if (readmeJson.content) {
        readmeText = Buffer.from(readmeJson.content, 'base64').toString('utf-8');
      }
    }
  } catch (e) {
    console.warn('[resumeInterviewService] Could not fetch README:', e.message);
  }

  // 3. Fetch languages breakdown (optional)
  let languages = [];
  try {
    const langRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/languages`, { headers });
    if (langRes.ok) {
      const langJson = await langRes.json();
      languages = Object.keys(langJson);
    }
  } catch (e) {
    console.warn('[resumeInterviewService] Could not fetch languages:', e.message);
  }

  // 4. Fetch package.json or requirements.txt (optional)
  let manifest = '';
  try {
    const pkgRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, { headers });
    if (pkgRes.ok) {
      const pkgJson = await pkgRes.json();
      if (pkgJson.content) {
        manifest = Buffer.from(pkgJson.content, 'base64').toString('utf-8');
      }
    } else {
      const reqRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/requirements.txt`, { headers });
      if (reqRes.ok) {
        const reqJson = await reqRes.json();
        if (reqJson.content) {
          manifest = Buffer.from(reqJson.content, 'base64').toString('utf-8');
        }
      }
    }
  } catch (e) {
    console.warn('[resumeInterviewService] Could not fetch manifest:', e.message);
  }

  return {
    owner,
    repo,
    fullName: repoData.full_name,
    description: repoData.description || 'No description provided.',
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    topics: repoData.topics || [],
    primaryLanguage: repoData.language || (languages[0] || 'Unknown'),
    languages,
    defaultBranch: repoData.default_branch,
    readmeSnippet: readmeText ? readmeText.slice(0, 4000) : '',
    manifestSnippet: manifest ? manifest.slice(0, 2000) : '',
  };
}

/**
 * Intelligent Fallback Generator
 * Generates high-quality contextual 360° technical interview questions if OpenAI API is unavailable or unconfigured.
 */
function generateFallbackQuestions({ candidateInfo, projects, focusCategory, difficulty }) {
  const pName = projects[0]?.name || 'Primary Project';
  const tech = (candidateInfo?.techStack?.languages || ['JavaScript', 'Python']).concat(
    candidateInfo?.techStack?.frameworks || ['React', 'Node.js']
  );
  const primaryLang = candidateInfo?.techStack?.languages?.[0] || 'JavaScript';

  const allQuestions = [
    {
      id: 'q-arch-1',
      category: 'architecture',
      projectName: pName,
      title: 'Architectural Decisions & Database Scaling Trade-offs',
      difficulty: difficulty || 'Hard',
      question: `In your project "${pName}", walk me through the overall system architecture. Why did you choose your primary datastore over alternatives, and how would you redesign the data ingestion pipeline if user traffic scaled 100x?`,
      interviewerIntent: 'Evaluates understanding of system boundaries, database query patterns, read/write throughput trade-offs, and horizontal scalability.',
      modelAnswer: `Discuss separation of concerns: stateless application servers, caching layer (e.g. Redis for hot sessions/queries), read replicas for high read loads, message queuing (Kafka/RabbitMQ) for asynchronous work, and database indexing or sharding strategies.`,
      probingFollowUps: [
        'How would you handle cache invalidation and prevent stale reads during peak traffic spikes?',
        'If your primary database experienced high latency or a failover, what graceful degradation strategy did you put in place?',
      ],
    },
    {
      id: 'q-deep-1',
      category: 'deep_dive',
      projectName: pName,
      title: 'Concurrency, State & Internal Protocol Mechanics',
      difficulty: difficulty || 'Medium',
      question: `Looking into the implementation details of "${pName}", how did you handle state synchronization and potential race conditions between multiple concurrent clients or asynchronous background workers?`,
      interviewerIntent: 'Probes deep technical mechanics: event-driven architecture, distributed locks, idempotency keys, and transaction isolation.',
      modelAnswer: `Explain concurrency control mechanisms: optimistic vs pessimistic locking, idempotent request handlers (using UUID tokens), database transactions (ACID guarantees), and how WebSocket / polling updates are broadcast safely.`,
      probingFollowUps: [
        'What specific telemetry or log metrics did you monitor to detect race conditions in production?',
        'How did you secure your API endpoints against replay attacks and token expiration?',
      ],
    },
    {
      id: 'q-code-1',
      category: 'coding_challenge',
      projectName: pName,
      title: 'Project Domain Coding Scenario: Rate Limiting & Queue Orchestration',
      difficulty: difficulty || 'Medium',
      question: `Implement a token-bucket rate limiter or sliding-window batch processor directly inspired by the high-throughput requirements in "${pName}".`,
      interviewerIntent: 'Tests live coding capability, clean code structure, time and space complexity analysis, and edge case handling (clock skew, burst requests).',
      modelAnswer: `Use a sliding window log or token bucket algorithm. Track timestamps or available tokens per user key. When a request arrives, refill tokens proportionally to elapsed time, decrement tokens if available, or reject with a retry-after delta.`,
      probingFollowUps: [
        'How would you distribute this rate limiter across a multi-node cluster without making the central cache a single point of contention?',
        'What is the Big-O time and space complexity of your algorithm per request?',
      ],
      codingDetails: {
        problemDescription: `### Domain Challenge: Token Bucket Rate Limiter\n\nImplement a class \`TokenBucketLimiter\` that accepts requests with capacity \`maxCapacity\` and refill rate \`refillRatePerSec\`.\n\n- \`allowRequest(userId, timestampMs)\`: Returns \`true\` if the request is permitted, or \`false\` if rate-limited.`,
        language: primaryLang.toLowerCase(),
        starterCode: primaryLang.toLowerCase() === 'python'
          ? `class TokenBucketLimiter:\n    def __init__(self, capacity: int, refill_rate_per_sec: float):\n        self.capacity = capacity\n        self.refill_rate = refill_rate_per_sec\n        self.buckets = {}\n\n    def allow_request(self, user_id: str, timestamp_ms: int) -> bool:\n        # TODO: Implement token refill and consumption logic\n        return True\n`
          : `class TokenBucketLimiter {\n  constructor(capacity, refillRatePerSec) {\n    this.capacity = capacity;\n    this.refillRatePerSec = refillRatePerSec;\n    this.buckets = new Map();\n  }\n\n  allowRequest(userId, timestampMs) {\n    // TODO: Implement token refill and consumption logic\n    return true;\n  }\n}\n`,
        exampleInput: 'capacity = 5, refillRate = 1/sec, 6 consecutive requests at t=0ms',
        exampleOutput: '[true, true, true, true, true, false]',
        constraints: [
          'Capacity > 0',
          'User IDs are alphanumeric strings',
          'Timestamp is monotonically non-decreasing per user',
        ],
      },
    },
    {
      id: 'q-trouble-1',
      category: 'troubleshooting',
      projectName: pName,
      title: 'Production Incident Simulation: Memory Leak & Latency Spike',
      difficulty: difficulty || 'Hard',
      question: `Suppose in "${pName}", after a new release, p99 latency jumps from 150ms to 4.2 seconds and CPU spikes to 95%. Walk me step-by-step through how you would triage, diagnose, and mitigate this live production issue.`,
      interviewerIntent: 'Assesses production maturity, observability (metrics, logs, traces), root cause analysis under pressure, and mitigation prioritization (rollback first vs live patch).',
      modelAnswer: `1. Immediate mitigation: Rollback the recent deployment or throttle non-critical background jobs to restore user SLA.\n2. Inspection: Check APM traces, heap dumps, garbage collection pauses, connection pool exhaustion, and slow query logs.\n3. Remediation: Patch the identified leak (e.g. unclosed connections or unbounded in-memory cache), add automated regression tests, and set up alert thresholds.`,
      probingFollowUps: [
        'How would you differentiate between an external API downstream timeout vs an internal memory leak?',
        'What post-mortem action items would you present to the engineering team?',
      ],
    },
    {
      id: 'q-behavioral-1',
      category: 'behavioral',
      projectName: pName,
      title: 'Engineering Trade-off & Technical Disagreement',
      difficulty: 'Medium',
      question: `During the development of "${pName}", describe a critical technical decision or architectural tradeoff where you had to push back or compromise. What was the conflict and what was the outcome?`,
      interviewerIntent: 'Assesses technical leadership, communication, pragmatism over dogmatism, and engineering maturity.',
      modelAnswer: `Structure using the STAR framework (Situation, Task, Action, Result). Highlight how technical data, benchmarks, or prototypes were used to align the team instead of subjective opinions.`,
      probingFollowUps: [
        'If you could rebuild that component today with what you now know, what would you do differently?',
        'How did this project impact the overall product velocity and developer ergonomics?',
      ],
    },
  ];

  if (focusCategory && focusCategory !== 'all') {
    return allQuestions.filter(q => q.category === focusCategory);
  }
  return allQuestions;
}

/**
 * Heuristic fallback parser for resume or github repo when OpenAI API key is unavailable
 */
function generateFallbackDossier({ resumeText, githubData, role, experienceLevel }) {
  const text = (resumeText || '') + ' ' + (githubData?.description || '') + ' ' + (githubData?.readmeSnippet || '');
  
  // Extract common tech words safely (handling C++, etc.)
  const techKeywords = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Go', 'Rust',
    'React', 'Next.js', 'Vue', 'Node.js', 'Express', 'Django', 'FastAPI', 'Spring Boot',
    'PostgreSQL', 'MongoDB', 'Redis', 'MySQL', 'GraphQL', 'Docker', 'Kubernetes',
    'AWS', 'Firebase', 'Kafka', 'WebSockets', 'TailwindCSS', 'Microservices'
  ];
  const detectedTech = techKeywords.filter(k => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i').test(text);
  });

  let projects = [];
  if (githubData) {
    projects.push({
      id: 'p-gh-1',
      name: githubData.repo || 'Repository Project',
      summary: githubData.description || 'Full-stack repository project.',
      techUsed: githubData.languages && githubData.languages.length > 0 ? githubData.languages : (detectedTech.slice(0, 4) || ['JavaScript']),
      keyHighlights: [
        `${githubData.stars || 0} stars on GitHub`,
        `Primary language: ${githubData.primaryLanguage || 'JavaScript'}`,
        `Analyzed source manifests and architecture`,
      ],
    });
  } else {
    // Try to extract project-like sections from resume
    const projectMatches = text.match(/(?:project|application|system|platform):\s*([^\n\r]+)/gi) || [];
    if (projectMatches.length > 0) {
      projects = projectMatches.slice(0, 3).map((m, i) => ({
        id: `p-${i + 1}`,
        name: m.replace(/(?:project|application|system|platform):\s*/i, '').trim().slice(0, 40) || `Project ${i + 1}`,
        summary: `Key engineering project detailed on candidate resume.`,
        techUsed: detectedTech.slice(i * 2, i * 2 + 4),
        keyHighlights: ['Designed and implemented core architecture', 'Demonstrated scalable software design'],
      }));
    } else {
      projects.push({
        id: 'p-1',
        name: 'Flagship Engineering Project',
        summary: 'Primary technical project highlighted in the candidate dossier.',
        techUsed: detectedTech.length > 0 ? detectedTech.slice(0, 5) : ['JavaScript', 'React', 'Node.js', 'PostgreSQL'],
        keyHighlights: ['Full-lifecycle implementation', 'Scalable design and database modeling'],
      });
    }
  }

  const candidate = {
    name: 'Candidate',
    roleSummary: role || (detectedTech.includes('React') ? 'Full-Stack Software Engineer' : 'Backend & Distributed Systems Engineer'),
    experienceLevel: experienceLevel || 'Mid-Senior Level',
    techStack: {
      languages: detectedTech.filter(t => ['JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Go', 'Rust'].includes(t)),
      frameworks: detectedTech.filter(t => ['React', 'Next.js', 'Vue', 'Node.js', 'Express', 'Django', 'FastAPI', 'Spring Boot'].includes(t)),
      databases: detectedTech.filter(t => ['PostgreSQL', 'MongoDB', 'Redis', 'MySQL'].includes(t)),
      cloudAndTools: detectedTech.filter(t => ['Docker', 'Kubernetes', 'AWS', 'Firebase', 'Kafka', 'GraphQL'].includes(t)),
    },
  };

  return { candidate, projects };
}

/**
 * Main Analysis and 360° Technical Question Generation Engine
 */
export async function analyzeAndGenerateInterview({
  resumeText = '',
  githubData = null,
  role = 'Software Engineer',
  experienceLevel = 'Mid-Level',
  focusCategory = 'all',
  difficulty = 'Medium',
}) {
  const contextSource = githubData
    ? `GitHub Repository: ${githubData.fullName}
Description: ${githubData.description}
Primary Language: ${githubData.primaryLanguage}
Languages Used: ${githubData.languages.join(', ')}
Topics: ${githubData.topics.join(', ')}
README Content:
${githubData.readmeSnippet}
Manifest Details (package/deps):
${githubData.manifestSnippet}`
    : `Resume Text:
${resumeText.slice(0, 8000)}`;

  const prompt = `
You are the Apollo Principal Technical Interview Architect, representing top-tier hiring committees (Google, Meta, Netflix, Stripe).
Your goal is to deeply analyze the candidate's past project(s) from their resume or GitHub repo, and craft a bespoke, rigorous 360° Technical Interview Suite.

Candidate Target Role: ${role}
Target Seniority: ${experienceLevel}
Preferred Question Difficulty: ${difficulty}
Focus Category Filter: ${focusCategory}

Candidate Project & Experience Data:
"""
${contextSource}
"""

CRITICAL INSTRUCTIONS:
1. Extract candidate profile and concrete past projects with their technical stack.
2. Formulate 5 to 7 high-impact, realistic technical interview questions tailored STRICTLY to their specific projects and architecture:
   - "architecture": System Design, Scalability, and Database Trade-offs
   - "deep_dive": Low-level Implementation, Concurrency, State, and Protocols
   - "coding_challenge": A hands-on coding scenario / algorithmic problem inspired directly by the candidate's project domain (MUST include starter code, sample I/O, and problem description)
   - "troubleshooting": Production Incident Simulation, Memory/CPU Bottlenecks, and Edge-Case Recovery
   - "behavioral": Tough Technical Tradeoffs, Engineering Disagreements, and Architecture Retrospectives
3. For EVERY question provide:
   - What top interviewers look for (evaluator intent / rubric)
   - Comprehensive model answer / architecture talking points
   - 2 realistic probing follow-up questions
4. Return ONLY a single valid JSON object adhering EXACTLY to the following schema:

{
  "candidate": {
    "name": "Candidate Name or Candidate",
    "roleSummary": "e.g., Senior Full-Stack Engineer",
    "experienceLevel": "e.g., Senior",
    "techStack": {
      "languages": ["TypeScript", "Python"],
      "frameworks": ["React", "Express"],
      "databases": ["PostgreSQL", "Redis"],
      "cloudAndTools": ["Docker", "AWS", "Kafka"]
    }
  },
  "projects": [
    {
      "id": "p-1",
      "name": "Project Name",
      "summary": "Concise summary of what the project does",
      "techUsed": ["React", "Node.js", "MongoDB"],
      "keyHighlights": ["Highlight 1", "Highlight 2"]
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "category": "architecture" | "deep_dive" | "coding_challenge" | "troubleshooting" | "behavioral",
      "projectName": "Name of relevant project",
      "title": "Short descriptive question title",
      "difficulty": "Easy" | "Medium" | "Hard",
      "question": "Full realistic interview question...",
      "interviewerIntent": "What the interviewer evaluates...",
      "modelAnswer": "Detailed guidance, architectural strategy, and key points...",
      "probingFollowUps": ["Follow-up question 1?", "Follow-up question 2?"],
      "codingDetails": {
        "problemDescription": "Markdown description of coding challenge...",
        "language": "javascript" | "python",
        "starterCode": "function solve() { ... }",
        "exampleInput": "input example",
        "exampleOutput": "output example",
        "constraints": ["Constraint 1", "Constraint 2"]
      }
    }
  ]
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert technical interviewer and FAANG hiring committee member. Return ONLY valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_completion_tokens: 3500,
    });

    const raw = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    if (parsed.candidate && parsed.projects && parsed.questions && parsed.questions.length > 0) {
      return {
        ...parsed,
        sourceType: githubData ? 'github' : 'resume',
        sourceName: githubData ? githubData.fullName : 'Uploaded Resume',
      };
    }
    throw new Error('LLM response missing expected structure');
  } catch (err) {
    console.warn('[resumeInterviewService] OpenAI generation failed, engaging smart fallback generator:', err.message);
    const { candidate, projects } = generateFallbackDossier({ resumeText, githubData, role, experienceLevel });
    const questions = generateFallbackQuestions({ candidateInfo: candidate, projects, focusCategory, difficulty });

    return {
      candidate,
      projects,
      questions,
      sourceType: githubData ? 'github' : 'resume',
      sourceName: githubData ? githubData.fullName : 'Uploaded Resume',
      note: 'Generated via Apollo Project Synthesis Engine',
    };
  }
}

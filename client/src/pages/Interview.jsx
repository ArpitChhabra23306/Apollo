import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import * as LucideIcons from 'lucide-react';
import CodeEditor from '../components/CodeEditor/CodeEditor';
import ImmersiveNav from '../components/ImmersiveNav';
import TabSwitchWarningModal from '../components/TabSwitchWarningModal/TabSwitchWarningModal';
import useTabFocusTracker from '../hooks/useTabFocusTracker';
import { streamAIChat, runCode } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Interview.css';

const PHASES = {
  LOBBY: 'lobby',
  SETUP: 'setup',
  CODING: 'coding',
  FOLLOWUP: 'followup',
  RESULT: 'result',
  DISQUALIFIED: 'disqualified',
};

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
];

function Interview() {
  const [phase, setPhase] = useState(PHASES.LOBBY);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [timeLeft, setTimeLeft] = useState(45 * 60);
  const [problem, setProblem] = useState('');
  const [code, setCode] = useState('// Your solution here...\n');
  const [language, setLanguage] = useState('javascript');
  const [runCount, setRunCount] = useState(0);
  const [maxRuns] = useState(3);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState(null);

  const { user } = useAuth();
  const navigate = useNavigate();
  const chatEndRef = useRef(null);

  // ── Tab & Window switch proctoring ──
  const isInterviewActive = phase === PHASES.CODING || phase === PHASES.FOLLOWUP;
  const {
    warningCount,
    showWarningModal,
    setShowWarningModal,
    violations,
    dismissModal,
    resetWarnings,
  } = useTabFocusTracker({
    isActive: isInterviewActive,
    maxWarnings: 3,
    alertSound: true,
    onDisqualify: () => {
      setPhase(PHASES.DISQUALIFIED);
      setShowWarningModal(false);
    },
  });

  // ── Phase transition helper ──
  const handleCompleteCoding = () => {
    setPhase(PHASES.FOLLOWUP);
    setMessages([{
      role: 'model',
      content: "Thank you for submitting your solution. I've reviewed it. Let me ask you a few follow-up questions.\n\n**First:** Walk me through your approach. Why did you choose this particular data structure or algorithm?"
    }]);
  };

  // ── Countdown timer ──
  useEffect(() => {
    let interval = null;
    if (phase === PHASES.CODING) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            handleCompleteCoding();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [phase]);

  // ── Auto-scroll chat ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Start the interview ──
  const startInterview = async () => {
    setLoading(true);
    setError(null);
    setPhase(PHASES.CODING);
    await streamAIChat({
      code: '// Candidate will write solution here',
      language,
      mode: 'interview_interviewer',
      history: [{ role: 'user', content: `Start the interview. Give me a ${difficulty} difficulty DSA/algorithm coding problem. Include: problem title, description, constraints, and 2 example test cases. Do NOT provide the solution.` }],
      onChunk: (chunk) => setProblem(prev => prev + chunk),
      onDone: () => setLoading(false),
      onError: (err) => { setLoading(false); setError(`Failed to generate problem: ${err}`); }
    });
  };

  // ── Run code (limited) ──
  const handleRun = async () => {
    if (runCount >= maxRuns || phase !== PHASES.CODING) return;
    setRunning(true);
    setRunCount(prev => prev + 1);
    try {
      const res = await runCode({ code, language });
      setOutput(res);
    } catch (e) {
      setOutput({ stderr: e.message });
    }
    setRunning(false);
  };

  // ── Follow-up chat ──
  const handleSendFollowup = async () => {
    if (!chatInput.trim() || loading) return;
    const text = chatInput;
    setChatInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages([...newMessages, { role: 'model', content: '' }]);
    setLoading(true);

    await streamAIChat({
      code,
      language,
      mode: 'interview_interviewer',
      history: newMessages,
      onChunk: (chunk) => setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + chunk };
        return updated;
      }),
      onDone: () => {
        setLoading(false);
        // Auto-transition to evaluation after 3 back-and-forth exchanges
        if (newMessages.filter(m => m.role === 'user').length >= 3) {
          setTimeout(() => {
            setPhase(PHASES.RESULT);
            evaluatePerformance(newMessages);
          }, 1500);
        }
      },
      onError: (err) => { setLoading(false); setError(`Follow-up error: ${err}`); }
    });
  };

  // ── AI Evaluation ──
  const evaluatePerformance = async (msgs) => {
    setLoading(true);
    const evalHistory = (msgs || messages).map(m => ({ role: m.role, content: m.content }));
    let evalText = '';

    const proctorAudit = warningCount > 0
      ? `\n\nPROCTORING INTEGRITY AUDIT: The candidate switched tabs or lost window focus ${warningCount} time(s) during this assessment. Consider this integrity violation in your assessment and hiring verdict.`
      : `\n\nPROCTORING INTEGRITY AUDIT: 0 tab switches detected. Full candidate focus and assessment integrity maintained.`;

    await streamAIChat({
      code,
      language,
      mode: 'interview_evaluator',
      history: [
        { role: 'user', content: `Here is the problem:\n${problem}\n\nHere is the candidate's code:\n\`\`\`${language}\n${code}\n\`\`\`\n\nHere is the follow-up discussion:\n${evalHistory.map(m => `${m.role === 'user' ? 'CANDIDATE' : 'INTERVIEWER'}: ${m.content}`).join('\n\n')}${proctorAudit}\n\nPlease evaluate this candidate.` }
      ],
      onChunk: (chunk) => {
        evalText += chunk;
        setResult(evalText);
      },
      onDone: () => setLoading(false),
      onError: (err) => { setLoading(false); setError(`Evaluation error: ${err}`); }
    });
  };

  // ── Retry interview ──
  const retryInterview = () => {
    resetWarnings();
    setPhase(PHASES.SETUP);
    setDifficulty('Medium');
    setTimeLeft(45 * 60);
    setProblem('');
    setCode('// Your solution here...\n');
    setRunCount(0);
    setMessages([]);
    setChatInput('');
    setResult(null);
    setOutput(null);
    setError(null);
  };

  // ═══════════════ RENDERS ═══════════════

  const renderLobby = () => (
    <div className="iv-setup-card" style={{ maxWidth: '800px' }}>
      <div className="iv-setup-header">
        <div className="iv-setup-icon">
          <LucideIcons.Briefcase size={36} color="#9B40E0" />
        </div>
        <h2>Interview Center</h2>
        <p className="iv-setup-sub">Choose your interview experience</p>
      </div>

      <div className="iv-setup-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div 
          className="iv-mode-card" 
          onClick={() => setPhase(PHASES.SETUP)}
          style={{ padding: '24px', border: '1px solid #333', borderRadius: '12px', cursor: 'pointer', transition: 'border-color 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = '#9B40E0'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = '#333'}
        >
          <LucideIcons.Bot size={48} color="#9B40E0" style={{ marginBottom: '16px' }} />
          <h3>Self-Practice Mode</h3>
          <p style={{ color: '#aaa', fontSize: '14px', marginTop: '8px' }}>Practice with our AI-driven technical interviewer. Features dynamic problem generation and behavioral follow-ups.</p>
        </div>

        <div 
          className="iv-mode-card" 
          style={{ padding: '24px', border: '1px solid #333', borderRadius: '12px', transition: 'border-color 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = '#9B40E0'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = '#333'}
        >
          <LucideIcons.Users size={48} color="#9B40E0" style={{ marginBottom: '16px' }} />
          <h3>Formal Interview Mode</h3>
          <p style={{ color: '#aaa', fontSize: '14px', marginTop: '8px', marginBottom: '20px' }}>Host a 1-on-1 collaborative session. Includes real-time video calling and synchronized code editing.</p>

          <button 
            onClick={() => {
              const roomId = Math.random().toString(36).substring(2, 10);
              navigate(`/interview/join/${roomId}?host=true`);
            }}
            style={{ width: '100%', padding: '10px', background: '#9B40E0', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '12px' }}
          >
            Create New Room
          </button>
          
          <div style={{ display: 'flex', width: '100%', gap: '8px' }}>
            <input 
              type="text" 
              placeholder="Paste Room ID or Link..." 
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', background: '#1e1e24', border: '1px solid #444', borderRadius: '6px', color: '#fff', fontSize: '14px' }}
            />
            <button 
              onClick={() => {
                if (joinRoomId.trim()) {
                  const id = joinRoomId.split('/').pop().split('?')[0];
                  navigate(`/interview/join/${id}`);
                }
              }}
              disabled={!joinRoomId.trim()}
              style={{ padding: '8px 16px', background: joinRoomId.trim() ? '#333' : '#222', color: joinRoomId.trim() ? '#fff' : '#666', border: '1px solid #444', borderRadius: '6px', cursor: joinRoomId.trim() ? 'pointer' : 'not-allowed' }}
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="iv-setup-card">
      <div className="iv-setup-header">
        <div className="iv-setup-icon">
          <LucideIcons.ShieldCheck size={36} color="#9B40E0" />
        </div>
        <h2>Technical Interview Simulator</h2>
        <p className="iv-setup-sub">45 minutes · Full-screen · Restricted Execution</p>
      </div>

      <div className="iv-setup-body">
        <label className="iv-field-label">Difficulty</label>
        <div className="iv-diff-selector">
          {['Easy', 'Medium', 'Hard'].map(d => (
            <button
              key={d}
              className={`iv-diff-btn ${difficulty === d ? 'active' : ''} iv-diff-${d.toLowerCase()}`}
              onClick={() => setDifficulty(d)}
            >
              {d}
            </button>
          ))}
        </div>

        <label className="iv-field-label">Language</label>
        <div className="iv-lang-selector">
          {LANGUAGES.map(l => (
            <button
              key={l.value}
              className={`iv-lang-btn ${language === l.value ? 'active' : ''}`}
              onClick={() => setLanguage(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="iv-rules">
          <div className="iv-rule"><LucideIcons.Clock size={13} /> <span>45-minute countdown — cannot be paused</span></div>
          <div className="iv-rule"><LucideIcons.Terminal size={13} /> <span>Limited to <strong>{maxRuns}</strong> code executions</span></div>
          <div className="iv-rule"><LucideIcons.MessageSquare size={13} /> <span>Follow-up behavioral questions after submission</span></div>
          <div className="iv-rule"><LucideIcons.ShieldAlert size={13} /> <span>Tab & window switching is <strong>strictly monitored</strong> and flagged</span></div>
          <div className="iv-rule"><LucideIcons.Award size={13} /> <span>AI Hiring Committee evaluates your performance</span></div>
        </div>
      </div>

      {error && <div className="iv-error">{error}</div>}

      <button className="iv-start-btn" onClick={startInterview} disabled={loading}>
        {loading ? (
          <><LucideIcons.Loader2 size={16} className="iv-spin" /> Generating Problem...</>
        ) : (
          <><LucideIcons.Play size={16} /> Begin Interview</>
        )}
      </button>
    </div>
  );

  const renderCoding = () => (
    <div className="iv-coding-layout">
      <div className="iv-problem-panel">
        <div className="iv-panel-header">
          <LucideIcons.Book size={14} />
          <span>Problem Statement</span>
          <span className="iv-difficulty-badge">{difficulty}</span>
        </div>
        <div className="iv-panel-body scrollable">
          {problem ? (
            <ReactMarkdown>{problem}</ReactMarkdown>
          ) : (
            <div className="iv-loading-problem">
              <LucideIcons.Loader2 size={20} className="iv-spin" />
              <span>Generating your challenge...</span>
            </div>
          )}
        </div>
      </div>
      <div className="iv-editor-panel">
        <div className="iv-panel-header">
          <LucideIcons.Code2 size={14} />
          <span>Solution · {LANGUAGES.find(l => l.value === language)?.label}</span>
        </div>
        <div className="iv-editor-wrapper">
          <CodeEditor value={code} onChange={setCode} language={language} theme="vs-dark" />
        </div>
        <div className="iv-console-area">
          <div className="iv-console-header">
            <span><LucideIcons.Terminal size={12} /> Terminal {output ? '— Result' : ''}</span>
            <div className="iv-run-status">
              Runs: <strong className={runCount >= maxRuns ? 'exhausted' : ''}>{runCount}/{maxRuns}</strong>
            </div>
          </div>
          <div className="iv-console-body">
            {running && <div className="iv-running"><LucideIcons.Loader2 size={14} className="iv-spin" /> Executing...</div>}
            {!running && output ? (
              <pre className={output.stderr ? 'err' : ''}>{output.stdout || output.stderr || 'No output'}</pre>
            ) : !running ? (
              <span className="muted">Run your solution to see output... ({maxRuns - runCount} runs remaining)</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  const renderFollowup = () => (
    <div className="iv-followup-layout">
      <div className="iv-chat-window">
        <div className="iv-panel-header">
          <LucideIcons.MessageSquare size={14} />
          <span>Follow-up Discussion</span>
          <span className="iv-phase-badge">Behavioral</span>
        </div>
        <div className="iv-chat-messages scrollable">
          {messages.map((m, i) => (
            <div key={i} className={`iv-msg ${m.role}`}>
              <div className="iv-msg-avatar">
                {m.role === 'model' ? <LucideIcons.UserCheck size={14} /> : (user?.username?.[0]?.toUpperCase() || 'U')}
              </div>
              <div className="iv-msg-bubble">
                <span className="iv-msg-role">{m.role === 'model' ? 'Interviewer' : 'You'}</span>
                <div className="iv-msg-content">
                  <ReactMarkdown>{m.content || '...'}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="iv-chat-input-area">
          <input
            type="text"
            placeholder="Explain your thinking..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendFollowup()}
            disabled={loading}
          />
          <button onClick={handleSendFollowup} disabled={loading || !chatInput.trim()}>
            {loading ? <LucideIcons.Loader2 size={16} className="iv-spin" /> : <LucideIcons.Send size={16} />}
          </button>
        </div>
      </div>
      <div className="iv-reference-code">
        <div className="iv-panel-header">
          <LucideIcons.FileCode size={14} />
          <span>Your Submitted Solution</span>
        </div>
        <div className="iv-ref-code-body">
          <CodeEditor value={code} onChange={() => {}} language={language} theme="vs-dark" />
        </div>
      </div>
    </div>
  );

  const renderResult = () => (
    <div className="iv-result-card">
      <div className="iv-result-header">
        <LucideIcons.Award size={48} color={result?.includes('HIRED') ? '#22c55e' : result?.includes('NO HIRE') ? '#f85149' : '#9B40E0'} />
        <h2>Interview Complete</h2>
        <p>Your performance has been evaluated by the Hiring Committee.</p>
      </div>

      <div className={`iv-integrity-card ${warningCount > 0 ? 'flagged' : 'verified'}`}>
        <div className="iv-integrity-icon">
          {warningCount > 0 ? <LucideIcons.ShieldAlert size={22} /> : <LucideIcons.ShieldCheck size={22} />}
        </div>
        <div className="iv-integrity-info">
          <h4>{warningCount > 0 ? `${warningCount} Tab Switch Violation(s) Logged` : 'Assessment Integrity: Verified'}</h4>
          <p>
            {warningCount > 0
              ? 'Candidate navigated away from the interview tab or window during the test. Violations were logged for evaluation.'
              : 'Zero tab or window switches detected throughout the entire interview session.'}
          </p>
        </div>
      </div>
      <div className="iv-result-body scrollable">
        {result ? (
          <ReactMarkdown>{result}</ReactMarkdown>
        ) : (
          <div className="iv-loading-problem">
            <LucideIcons.Loader2 size={20} className="iv-spin" />
            <span>Evaluating your performance...</span>
          </div>
        )}
      </div>
      <div className="iv-result-actions">
        <button className="iv-retry-btn" onClick={retryInterview}>
          <LucideIcons.RotateCcw size={14} /> Try Again
        </button>
        <button className="iv-exit-btn" onClick={() => navigate('/workspace')}>
          <LucideIcons.ArrowLeft size={14} /> Back to Workspace
        </button>
      </div>
    </div>
  );

  const renderDisqualified = () => (
    <div className="iv-result-card iv-disqualified-card">
      <div className="iv-result-header iv-disqualified-header">
        <div className="iv-disqualified-icon-wrap">
          <LucideIcons.ShieldAlert size={56} color="#ef4444" />
        </div>
        <h2 style={{ color: '#f87171' }}>Interview Terminated</h2>
        <span className="iv-disqualified-tag">DISQUALIFIED · MALPRACTICE DETECTED</span>
        <p style={{ marginTop: '8px' }}>
          You navigated away from the interview window 3 times, violating assessment integrity policies.
        </p>
      </div>

      <div className="iv-result-body scrollable">
        <div className="iv-verdict-box">
          <div className="iv-verdict-title">HIRING COMMITTEE VERDICT</div>
          <div className="iv-verdict-badge">AUTOMATIC NO HIRE (0% INTEGRITY SCORE)</div>
          <p className="iv-verdict-text">
            The candidate repeatedly lost window and tab focus during a proctored technical challenge.
            Assessment protocol stipulates immediate termination and disqualification upon 3 integrity infractions.
          </p>
        </div>

        {violations && violations.length > 0 && (
          <div className="iv-violations-log-card">
            <h4><LucideIcons.Clock size={14} /> Recorded Violation Trail</h4>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Timestamp</th>
                  <th>Infraction Reason</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id}>
                    <td style={{ color: '#ef4444', fontWeight: 'bold' }}>Violation #{v.count}</td>
                    <td style={{ fontFamily: 'monospace' }}>{v.timestamp}</td>
                    <td>{v.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="iv-result-actions">
        <button className="iv-retry-btn" onClick={retryInterview}>
          <LucideIcons.RotateCcw size={14} /> Restart Interview
        </button>
        <button className="iv-exit-btn" onClick={() => navigate('/workspace')}>
          <LucideIcons.ArrowLeft size={14} /> Back to Workspace
        </button>
      </div>
    </div>
  );

  return (
    <div className="iv-root">
      <ImmersiveNav
        title="Technical Interview"
        subtitle={
          phase === PHASES.LOBBY ? 'Select Mode' :
          phase === PHASES.SETUP ? 'Configure your session' :
          phase === PHASES.CODING ? `Coding · ${difficulty}` :
          phase === PHASES.FOLLOWUP ? 'Behavioral Follow-up' :
          phase === PHASES.DISQUALIFIED ? 'Terminated · Disqualified' :
          'Evaluation'
        }
        timer={phase === PHASES.CODING ? formatTime(timeLeft) : null}
        onExit={() => {
          if (phase === PHASES.SETUP || phase === PHASES.DISQUALIFIED || window.confirm("Quitting now will mark this session as 'Incomplete'. Are you sure?")) {
            navigate('/workspace');
          }
        }}
        actions={
          phase === PHASES.DISQUALIFIED ? (
            <div className="iv-proctor-pill warning" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', borderColor: '#ef4444' }}>
              <LucideIcons.Ban size={13} />
              <span>Disqualified</span>
            </div>
          ) : (phase === PHASES.CODING || phase === PHASES.FOLLOWUP) && (
            <div className="iv-nav-actions">
              <div 
                className={`iv-proctor-pill ${warningCount > 0 ? 'warning' : 'clean'}`}
                onClick={() => warningCount > 0 && setShowWarningModal(true)}
                title={warningCount > 0 ? `${warningCount} tab switch warning(s). Click to view details.` : 'Proctoring Active: Tab and window switches are tracked'}
              >
                {warningCount > 0 ? (
                  <>
                    <LucideIcons.AlertTriangle size={13} />
                    <span>{warningCount} Warning{warningCount > 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <LucideIcons.ShieldCheck size={13} />
                    <span>Proctor Active</span>
                  </>
                )}
              </div>

              {phase === PHASES.CODING && (
                <>
                  <button className="iv-nav-run-btn" onClick={handleRun} disabled={runCount >= maxRuns || running}>
                    {running ? <LucideIcons.Loader2 size={13} className="iv-spin" /> : <LucideIcons.Play size={13} />}
                    {running ? 'Running...' : `Run (${maxRuns - runCount})`}
                  </button>
                  <button className="iv-nav-submit-btn" onClick={handleCompleteCoding}>
                    <LucideIcons.CheckSquare size={13} /> Submit Solution
                  </button>
                </>
              )}
            </div>
          )
        }
      />

      <main className="iv-content">
        {phase === PHASES.LOBBY && renderLobby()}
        {phase === PHASES.SETUP && renderSetup()}
        {phase === PHASES.CODING && renderCoding()}
        {phase === PHASES.FOLLOWUP && renderFollowup()}
        {phase === PHASES.RESULT && renderResult()}
        {phase === PHASES.DISQUALIFIED && renderDisqualified()}
      </main>

      <TabSwitchWarningModal
        isOpen={showWarningModal}
        warningCount={warningCount}
        maxWarnings={3}
        onAcknowledge={dismissModal}
        onDisqualify={() => {
          setPhase(PHASES.DISQUALIFIED);
          dismissModal();
        }}
        violations={violations}
      />
    </div>
  );
}

export default Interview;

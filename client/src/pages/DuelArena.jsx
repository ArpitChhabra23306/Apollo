import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import * as LucideIcons from 'lucide-react';
import toast from 'react-hot-toast';

import CodeEditor from '../components/CodeEditor/CodeEditor';
import OpponentProgress from '../components/Duel/OpponentProgress';
import PodiumModal from '../components/Duel/PodiumModal';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../services/api';
import './DuelArena.css';

const TOPIC_PRESETS = ['Arrays', 'Strings', 'Two Pointers', 'Hash Map', 'Dynamic Programming', 'Math'];

export default function DuelArena() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const socketRef = useRef(null);

  // Room & Contest State
  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [isHost, setIsHost] = useState(location.state?.isHost ?? false);
  const [problem, setProblem] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [showPodium, setShowPodium] = useState(false);

  // Problem Setup State (Host Only)
  const [setupMode, setSetupMode] = useState('prompt'); // 'prompt' | 'preset'
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('Medium');
  const [selectedTopic, setSelectedTopic] = useState('Arrays');
  const [isGenerating, setIsGenerating] = useState(false);

  // Coding & Submission State
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState('');
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [activeConsoleTab, setActiveConsoleTab] = useState('samples'); // 'samples' | 'details'

  // Panel sizing
  const [leftWidth, setLeftWidth] = useState(420);
  const [consoleHeight, setConsoleHeight] = useState(200);

  const cleanRoomId = (roomId || '').toUpperCase();

  // ── 1. Connect & Join Room ──
  useEffect(() => {
    const s = io(`${API_BASE}/duel`, { transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('connect', () => {
      if (location.state?.isHost && !room) {
        s.emit('duel:create-room', {
          roomId: cleanRoomId,
          user,
          maxPlayers: location.state?.maxPlayers || 2,
          durationMinutes: location.state?.durationMinutes || 30,
        });
      } else {
        s.emit('duel:join-room', {
          roomId: cleanRoomId,
          user,
        });
      }
    });

    s.on('duel:room-created', ({ roomId: createdId, room: roomData }) => {
      setRoom(roomData);
      setRoomError(null);
      setIsHost(true);
      if (createdId !== cleanRoomId) {
        navigate(`/duel/${createdId}`, { replace: true, state: { isHost: true } });
      }
    });

    s.on('duel:room-updated', (roomData) => {
      setRoom(roomData);
      setRoomError(null);
      if (roomData.players) {
        const me = roomData.players.find((p) => p.id === (user?.id || user?._id));
        if (me) setIsHost(me.isHost);
      }
      if (roomData.problem) {
        setProblem(roomData.problem);
        if (!code && roomData.status === 'active') {
          const initialCode = roomData.problem.starterCode?.[language] || roomData.problem.starterCode?.javascript || '';
          setCode(initialCode);
        }
      }
      if (roomData.startTime && roomData.status === 'active') {
        const endTime = roomData.startTime + (roomData.durationSeconds || 1800) * 1000;
        setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
      }
    });

    s.on('duel:problem-set-success', ({ problem: prob }) => {
      setProblem(prob);
      toast.success('DSA Problem configured & locked!', { icon: '🔒' });
    });

    s.on('duel:problem-ready', (meta) => {
      toast.success(`Host locked in challenge: "${meta.title}" (${meta.difficulty})`);
    });

    s.on('duel:countdown-tick', ({ count }) => {
      setCountdown(count);
      setRoom((prev) => (prev ? { ...prev, status: 'countdown' } : prev));
    });

    s.on('duel:contest-started', ({ problem: contestProblem, startTime, durationSeconds }) => {
      setCountdown(null);
      setProblem(contestProblem);
      setRoom((prev) => (prev ? { ...prev, status: 'active', problem: contestProblem, startTime } : prev));
      const initialCode = contestProblem.starterCode?.[language] || contestProblem.starterCode?.javascript || '';
      setCode(initialCode);

      // Start contest countdown timer
      const endTime = startTime + durationSeconds * 1000;
      setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));

      toast.success('Contest Started! Good luck!', { icon: '🚀' });
    });

    s.on('duel:progress-broadcast', ({ players, rankings: currentRankings }) => {
      setRoom((prev) => (prev ? { ...prev, players } : prev));
      setRankings(currentRankings);
    });

    s.on('duel:test-results', (results) => {
      setIsRunningTests(false);
      setIsSubmitting(false);
      setTestResults(results);

      if (results.isAllPassed) {
        toast.success('🎉 ALL TEST CASES PASSED! Perfect solution!', { duration: 4000 });
      } else if (results.passedCount > 0) {
        toast(`${results.passedCount}/${results.totalCount} test cases passed`, { icon: '⚠️' });
      } else {
        toast.error('0 test cases passed. Review your logic and try again.');
      }
    });

    s.on('duel:contest-finished', ({ rankings: finalRankings }) => {
      setRankings(finalRankings);
      setShowPodium(true);
    });

    s.on('duel:error', ({ message }) => {
      toast.error(message);
      if (!room) {
        setRoomError(message);
      }
      setIsGenerating(false);
      setIsRunningTests(false);
      setIsSubmitting(false);
    });

    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, [cleanRoomId]);

  // ── 2. Contest Timer ──
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || room?.status !== 'active') return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft, room?.status]);

  // Sync starter code when language switches
  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    if (problem?.starterCode?.[newLang]) {
      setCode(problem.starterCode[newLang]);
    }
  };

  // ── 3. Host Problem Generation ──
  const handleGenerateProblem = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/duel/generate-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: setupMode === 'prompt' ? customPrompt : undefined,
          difficulty: selectedDifficulty,
          topic: setupMode === 'preset' ? selectedTopic : undefined,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to generate problem');

      // Set problem locally and send to room socket
      setProblem(data.problem);
      socketRef.current?.emit('duel:set-problem', {
        roomId: cleanRoomId,
        problem: data.problem,
      });
    } catch (err) {
      toast.error(`Problem Generation Failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── 4. Host Starts Contest ──
  const handleStartContest = () => {
    if (!problem) return toast.error('Please generate or set a problem first');
    if ((room?.players?.length || 0) < 2) {
      return toast.error('Need at least 2 players in the room to duel');
    }
    socketRef.current?.emit('duel:start-contest', { roomId: cleanRoomId });
  };

  // ── 5. Run Sample Tests ──
  const handleRunSampleTests = () => {
    if (!code.trim() || isRunningTests || isSubmitting) return;
    setIsRunningTests(true);
    socketRef.current?.emit('duel:submit-code', {
      roomId: cleanRoomId,
      code,
      language,
      sampleOnly: true,
    });
  };

  // ── 6. Submit Full Solution ──
  const handleSubmitSolution = () => {
    if (!code.trim() || isRunningTests || isSubmitting) return;
    setIsSubmitting(true);
    socketRef.current?.emit('duel:submit-code', {
      roomId: cleanRoomId,
      code,
      language,
      sampleOnly: false,
    });
  };

  const formatClock = (seconds) => {
    if (seconds == null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Contest link copied to clipboard!');
  };

  // ── RENDER: 0. Room Error or Loading ──
  if (roomError) {
    return (
      <div className="duel-arena-root pre-lobby" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="pre-lobby-card" style={{ maxWidth: '420px', textAlign: 'center', alignItems: 'center', margin: 'auto' }}>
          <LucideIcons.AlertTriangle size={36} color="#ef4444" />
          <h3 style={{ margin: '0.5rem 0 0 0', color: '#ffffff' }}>Contest Room Error</h3>
          <p style={{ color: '#888899', fontSize: '0.85rem' }}>{roomError}</p>
          <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1rem' }}>
            <button type="button" className="duel-action-btn sample-btn" onClick={() => navigate('/duel')}>
              <LucideIcons.ArrowLeft size={14} /> Back to Lobby
            </button>
            <button
              type="button"
              className="duel-action-btn submit-btn"
              onClick={() => {
                setRoomError(null);
                socketRef.current?.emit('duel:create-room', {
                  roomId: cleanRoomId,
                  user,
                  maxPlayers: 2,
                  durationMinutes: 30,
                });
              }}
            >
              <LucideIcons.PlusCircle size={14} /> Create This Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="duel-arena-root pre-lobby" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', margin: 'auto' }}>
          <LucideIcons.Loader2 size={36} color="#9B40E0" className="ide-spin" />
          <span style={{ fontSize: '0.9rem', color: '#aaaaaa' }}>Connecting to Contest Arena ({cleanRoomId})...</span>
        </div>
      </div>
    );
  }

  // ── RENDER: 1. Pre-Contest Lobby ──
  if (room.status === 'waiting') {
    return (
      <div className="duel-arena-root pre-lobby">
        <header className="duel-arena-topbar">
          <div className="topbar-left" onClick={() => navigate('/duel')}>
            <LucideIcons.ArrowLeft size={16} />
            <span>Leave Lobby</span>
          </div>
          <div className="topbar-center">
            <span className="room-code-tag" onClick={copyRoomLink} title="Click to copy invite link">
              <LucideIcons.Hash size={13} /> {cleanRoomId}
              <LucideIcons.Copy size={11} />
            </span>
            <span className="room-cap-tag">
              {room.players?.length || 1} / {room.maxPlayers || 2} Players
            </span>
          </div>
          <div className="topbar-right">
            <button type="button" className="share-btn" onClick={copyRoomLink}>
              <LucideIcons.Share2 size={13} /> Share Room
            </button>
          </div>
        </header>

        <div className="pre-lobby-body">
          <div className="pre-lobby-grid">
            {/* Left: Problem Setter (Host) or Waiting Message (Contestant) */}
            <div className="pre-lobby-card problem-setup-card">
              <div className="card-title">
                <LucideIcons.BrainCircuit size={18} color="#9B40E0" />
                <h3>Contest Challenge Setup</h3>
                {isHost && <span className="host-badge">Admin Control</span>}
              </div>

              {isHost ? (
                <div className="host-setup-form">
                  <div className="setup-tabs">
                    <button
                      type="button"
                      className={`setup-tab ${setupMode === 'prompt' ? 'active' : ''}`}
                      onClick={() => setSetupMode('prompt')}
                    >
                      <LucideIcons.MessageSquare size={13} /> Explain to AI
                    </button>
                    <button
                      type="button"
                      className={`setup-tab ${setupMode === 'preset' ? 'active' : ''}`}
                      onClick={() => setSetupMode('preset')}
                    >
                      <LucideIcons.Sparkles size={13} /> AI Difficulty Presets
                    </button>
                  </div>

                  {setupMode === 'prompt' ? (
                    <div className="setup-group">
                      <label>Describe the problem to AI:</label>
                      <textarea
                        className="setup-textarea"
                        placeholder="e.g. A problem where you find the longest palindromic substring in an array of strings. Must be O(N) or O(N log N)..."
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        rows={4}
                      />
                      <div className="setup-inline">
                        <label>Difficulty:</label>
                        <div className="diff-pills">
                          {['Easy', 'Medium', 'Hard'].map((d) => (
                            <button
                              key={d}
                              type="button"
                              className={`diff-pill ${d.toLowerCase()} ${selectedDifficulty === d ? 'active' : ''}`}
                              onClick={() => setSelectedDifficulty(d)}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="setup-group">
                      <label>Select Difficulty:</label>
                      <div className="diff-pills">
                        {['Easy', 'Medium', 'Hard'].map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`diff-pill ${d.toLowerCase()} ${selectedDifficulty === d ? 'active' : ''}`}
                            onClick={() => setSelectedDifficulty(d)}
                          >
                            {d}
                          </button>
                        ))}
                      </div>

                      <label style={{ marginTop: '0.75rem' }}>Select Topic:</label>
                      <div className="topic-chips">
                        {TOPIC_PRESETS.map((top) => (
                          <button
                            key={top}
                            type="button"
                            className={`topic-chip ${selectedTopic === top ? 'active' : ''}`}
                            onClick={() => setSelectedTopic(top)}
                          >
                            {top}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="generate-problem-btn"
                    onClick={handleGenerateProblem}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <LucideIcons.Loader2 size={15} className="ide-spin" />
                        <span>AI Generating Problem & Test Harness...</span>
                      </>
                    ) : (
                      <>
                        <LucideIcons.Sparkles size={15} />
                        <span>{problem ? 'Regenerate Challenge' : 'Generate DSA Challenge'}</span>
                      </>
                    )}
                  </button>

                  {/* Problem Preview for Host */}
                  {problem && (
                    <div className="problem-preview-box">
                      <div className="preview-header">
                        <h4>{problem.title}</h4>
                        <span className={`diff-tag ${problem.difficulty?.toLowerCase()}`}>{problem.difficulty}</span>
                      </div>
                      <p className="preview-desc">{problem.description?.slice(0, 180)}…</p>
                      <div className="preview-footer">
                        <span>🧪 {problem.testCases?.length || 0} Test Cases Generated</span>
                        <span className="secret-lock-pill">
                          <LucideIcons.Lock size={10} /> Hidden from contestants until start
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="contestant-waiting-box">
                  <div className="waiting-spinner">
                    <LucideIcons.Hourglass size={32} color="#9B40E0" />
                  </div>
                  <h4>Waiting for Host to Start</h4>
                  <p>
                    {room.hasProblemSet
                      ? 'The host has locked in the challenge! Prepare your editor.'
                      : 'The host is currently configuring the DSA challenge with AI...'}
                  </p>
                  <span className="secret-notice">
                    <LucideIcons.Lock size={12} /> The problem will unlock simultaneously when the countdown begins.
                  </span>
                </div>
              )}
            </div>

            {/* Right: Players in Lobby */}
            <div className="pre-lobby-card players-card">
              <div className="card-title">
                <LucideIcons.Users size={18} color="#22c55e" />
                <h3>Connected Contestants</h3>
                <span className="room-count">{room.players?.length} / {room.maxPlayers}</span>
              </div>

              <div className="lobby-players-list">
                {room.players?.map((p) => (
                  <div key={p.id} className="lobby-player-row">
                    <div className="player-avatar">
                      {(p.username || 'P').charAt(0).toUpperCase()}
                    </div>
                    <div className="player-meta">
                      <span className="player-name">
                        {p.username}
                        {p.id === (user?.id || user?._id) && <span className="you-tag">YOU</span>}
                        {p.isHost && <span className="host-tag">HOST</span>}
                      </span>
                      <span className="player-status ready">
                        <LucideIcons.CheckCircle2 size={11} /> Ready to duel
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Start Contest CTA */}
              {isHost ? (
                <div className="start-contest-wrap">
                  <button
                    type="button"
                    className="start-contest-btn"
                    onClick={handleStartContest}
                    disabled={!problem || (room.players?.length || 0) < 2}
                  >
                    <LucideIcons.Play size={16} fill="currentColor" />
                    <span>Start Contest (3s Countdown)</span>
                  </button>
                  {(room.players?.length || 0) < 2 && (
                    <span className="min-players-hint">
                      <LucideIcons.Info size={11} /> At least 2 players needed. Share the room code to invite!
                    </span>
                  )}
                </div>
              ) : (
                <div className="contestant-status-banner">
                  <LucideIcons.ShieldAlert size={14} color="#facc15" />
                  <span>Ready! The contest will start as soon as the host launches it.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: 2. Live Contest Arena ──
  return (
    <div className="duel-arena-root active-contest">
      {/* 3... 2... 1... Countdown Overlay */}
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-box">
            <span className="countdown-number">{countdown}</span>
            <span className="countdown-text">GET READY!</span>
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="duel-arena-topbar">
        <div className="topbar-left">
          <span className="duel-logo-pill">
            <LucideIcons.Swords size={14} color="#facc15" /> DUEL
          </span>
          <span className="contest-title">{problem?.title || 'DSA Contest Challenge'}</span>
          <span className={`diff-tag ${problem?.difficulty?.toLowerCase()}`}>
            {problem?.difficulty || 'Medium'}
          </span>
        </div>

        <div className="topbar-center">
          <div className={`duel-timer-pill ${timeLeft && timeLeft < 300 ? 'urgent' : ''}`}>
            <LucideIcons.Clock size={14} />
            <span>{formatClock(timeLeft)}</span>
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="duel-action-btn sample-btn"
            onClick={handleRunSampleTests}
            disabled={isRunningTests || isSubmitting}
            title="Test against sample cases"
          >
            {isRunningTests ? <LucideIcons.Loader2 size={13} className="ide-spin" /> : <LucideIcons.Play size={13} />}
            <span>Run Tests</span>
          </button>

          <button
            type="button"
            className="duel-action-btn submit-btn"
            onClick={handleSubmitSolution}
            disabled={isRunningTests || isSubmitting}
            title="Submit solution for evaluation & live ranking"
          >
            {isSubmitting ? <LucideIcons.Loader2 size={13} className="ide-spin" /> : <LucideIcons.Send size={13} />}
            <span>Submit Solution</span>
          </button>

          {isHost && (
            <button
              type="button"
              className="end-contest-btn"
              onClick={() => {
                if (window.confirm('End this contest for all players?')) {
                  socketRef.current?.emit('duel:end-contest', { roomId: cleanRoomId });
                }
              }}
              title="End contest now"
            >
              <LucideIcons.Square size={13} />
            </button>
          )}
        </div>
      </header>

      {/* Arena Body: 3 Columns (Problem | Monaco Editor | Opponents) */}
      <div className="duel-arena-body">
        {/* Left Column: Problem Statement */}
        <section className="duel-problem-panel" style={{ width: leftWidth }}>
          <div className="panel-header">
            <LucideIcons.BookOpen size={14} color="#9B40E0" />
            <span>Problem Description</span>
          </div>

          <div className="problem-content-scroll">
            <h2 className="prob-title">{problem?.title}</h2>
            <div className="prob-meta-row">
              <span className={`diff-badge ${problem?.difficulty?.toLowerCase()}`}>{problem?.difficulty}</span>
              {problem?.topic && <span className="topic-badge">{problem.topic}</span>}
              <span className="constraints-badge">{problem?.constraints?.length || 0} constraints</span>
            </div>

            <div className="prob-section">
              <p className="prob-description">{problem?.description}</p>
            </div>

            {/* Examples */}
            {problem?.examples?.map((ex, idx) => (
              <div key={idx} className="prob-example-box">
                <h4>Example {idx + 1}:</h4>
                <div className="ex-row"><strong>Input:</strong> <code>{ex.input}</code></div>
                <div className="ex-row"><strong>Output:</strong> <code>{ex.output}</code></div>
                {ex.explanation && (
                  <div className="ex-row"><strong>Explanation:</strong> <span>{ex.explanation}</span></div>
                )}
              </div>
            ))}

            {/* Constraints */}
            {problem?.constraints && (
              <div className="prob-section">
                <h4>Constraints:</h4>
                <ul className="prob-constraints-list">
                  {problem.constraints.map((c, i) => (
                    <li key={i}><code>{c}</code></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Center Column: Editor & Test Console */}
        <main className="duel-editor-panel">
          {/* Editor Header */}
          <div className="editor-top-strip">
            <div className="lang-select-wrap">
              <LucideIcons.Code2 size={13} color="#9B40E0" />
              <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
                <option value="javascript">JavaScript (Node.js)</option>
                <option value="python">Python 3</option>
              </select>
            </div>
            <span className="editor-fn-tag">Function: <code>{problem?.functionName || 'solve'}</code></span>
          </div>

          {/* Monaco Editor */}
          <div className="monaco-container">
            <CodeEditor
              language={language}
              value={code}
              onChange={setCode}
              theme="vs-dark"
            />
          </div>

          {/* Test Case Console Drawer */}
          <div className="duel-console-drawer" style={{ height: consoleHeight }}>
            <div className="console-header">
              <div className="console-tabs">
                <button
                  type="button"
                  className={`console-tab ${activeConsoleTab === 'samples' ? 'active' : ''}`}
                  onClick={() => setActiveConsoleTab('samples')}
                >
                  <LucideIcons.Terminal size={12} /> Test Cases
                </button>
                {testResults && (
                  <span className={`console-pass-badge ${testResults.isAllPassed ? 'all-pass' : ''}`}>
                    {testResults.passedCount} / {testResults.totalCount} Passed
                  </span>
                )}
              </div>
              <button
                type="button"
                className="console-toggle"
                onClick={() => setConsoleHeight((h) => (h > 60 ? 40 : 200))}
              >
                {consoleHeight > 60 ? <LucideIcons.ChevronDown size={14} /> : <LucideIcons.ChevronUp size={14} />}
              </button>
            </div>

            <div className="console-body">
              {testResults ? (
                <div className="test-results-grid">
                  {testResults.results?.map((res, i) => (
                    <div key={res.id || i} className={`test-res-card ${res.passed ? 'passed' : 'failed'}`}>
                      <div className="test-res-top">
                        <span className="test-res-title">
                          {res.passed ? (
                            <LucideIcons.CheckCircle2 size={13} color="#22c55e" />
                          ) : (
                            <LucideIcons.XCircle size={13} color="#ef4444" />
                          )}
                          Test #{i + 1} {res.isHidden ? '(Hidden)' : ''}
                        </span>
                        <span className="test-res-time">{res.timeMs}ms</span>
                      </div>

                      {!res.isHidden && (
                        <div className="test-res-details">
                          <div className="tr-line"><strong>Input:</strong> <code>{res.input}</code></div>
                          <div className="tr-line"><strong>Expected:</strong> <code>{res.expected}</code></div>
                          <div className="tr-line">
                            <strong>Actual:</strong> <code className={res.passed ? 'ok' : 'err'}>{res.actual}</code>
                          </div>
                        </div>
                      )}
                      {res.isHidden && (
                        <div className="test-res-hidden">
                          <span>{res.passed ? 'Passed edge case.' : (res.error || 'Failed edge case.')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="console-empty">
                  <p>Click <strong>Run Tests</strong> to check sample cases or <strong>Submit Solution</strong> to compete for the leaderboard.</p>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Right Column: Live Opponent Progress */}
        <aside className="duel-opponents-panel">
          <OpponentProgress
            players={room?.players || []}
            currentUserId={user?.id || user?._id}
            totalTests={problem?.testCases?.length || 5}
          />
        </aside>
      </div>

      {/* Podium Modal */}
      {showPodium && (
        <PodiumModal
          rankings={rankings.length ? rankings : (room?.players || [])}
          currentUserId={user?.id || user?._id}
          onLeave={() => navigate('/duel')}
        />
      )}
    </div>
  );
}

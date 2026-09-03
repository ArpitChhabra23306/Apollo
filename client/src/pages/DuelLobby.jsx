import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import './DuelLobby.css';

export default function DuelLobby() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [capacity, setCapacity] = useState(2);
  const [duration, setDuration] = useState(30);
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = () => {
    setIsCreating(true);
    // Generate a clean 6-character room code client-side or pass via query params
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Navigate to the arena with room configuration
    navigate(`/duel/${code}`, {
      state: {
        isHost: true,
        maxPlayers: capacity,
        durationMinutes: duration,
      },
    });
  };

  const handleJoinRoom = (e) => {
    e?.preventDefault();
    const clean = joinCode.trim().toUpperCase();
    if (!clean) {
      return toast.error('Please enter a room code');
    }
    if (clean.length < 4) {
      return toast.error('Invalid room code format');
    }

    navigate(`/duel/${clean}`, {
      state: { isHost: false },
    });
  };

  return (
    <div className="duel-lobby-root">
      {/* Top Navbar */}
      <header className="duel-lobby-nav">
        <div className="duel-nav-left" onClick={() => navigate('/workspace')} role="button" tabIndex={0}>
          <LucideIcons.Sparkles size={18} color="#9B40E0" />
          <span className="duel-brand">Apollo</span>
          <span className="duel-pill">DUEL ARENA</span>
        </div>

        <div className="duel-nav-right">
          <button className="duel-nav-btn" onClick={() => navigate('/workspace')}>
            <LucideIcons.LayoutGrid size={15} /> Workspace
          </button>
          <button className="duel-nav-btn" onClick={() => navigate('/ide')}>
            <LucideIcons.Code size={15} /> VS Code IDE
          </button>
          <div className="duel-user-chip">
            <div className="duel-avatar">{(user?.username || 'U').charAt(0).toUpperCase()}</div>
            <span>{user?.username || 'User'}</span>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <main className="duel-lobby-content">
        <div className="duel-hero">
          <div className="duel-hero-badge">
            <LucideIcons.Swords size={14} color="#facc15" />
            <span>Real-Time Competitive Arena</span>
          </div>
          <h1>1v1 Speed Code Duel</h1>
          <p>
            Race against 2 to 5 developers to solve AI-generated algorithmic challenges.
            Track your opponents' test cases in real-time, conquer edge cases, and take 1st place on the podium.
          </p>
        </div>

        {/* Action Grid: Create vs Join */}
        <div className="duel-action-grid">
          {/* Create Room Card */}
          <div className="duel-card create-card">
            <div className="duel-card-header">
              <div className="duel-card-icon purple">
                <LucideIcons.PlusCircle size={22} color="#9B40E0" />
              </div>
              <div>
                <h2>Create Contest Arena</h2>
                <p>Host a private room for up to 5 developers.</p>
              </div>
            </div>

            <div className="duel-card-body">
              {/* Max Capacity Selector */}
              <div className="duel-field">
                <label>
                  <LucideIcons.Users size={14} /> Room Capacity (Players)
                </label>
                <div className="duel-capacity-chips">
                  {[2, 3, 4, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      className={`duel-chip ${capacity === num ? 'active' : ''}`}
                      onClick={() => setCapacity(num)}
                    >
                      {num === 2 ? '1v1 (2)' : `${num} Players`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contest Duration Selector */}
              <div className="duel-field">
                <label>
                  <LucideIcons.Timer size={14} /> Contest Duration
                </label>
                <div className="duel-capacity-chips">
                  {[15, 30, 45].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      className={`duel-chip ${duration === mins ? 'active' : ''}`}
                      onClick={() => setDuration(mins)}
                    >
                      {mins} mins
                    </button>
                  ))}
                </div>
              </div>

              <div className="duel-info-box">
                <LucideIcons.ShieldCheck size={14} color="#22c55e" />
                <span>As Admin, you pick or let AI generate the problem before start. It remains secret to players until the countdown!</span>
              </div>

              <button
                type="button"
                className="duel-primary-btn"
                onClick={handleCreateRoom}
                disabled={isCreating}
              >
                <LucideIcons.Swords size={16} />
                <span>Create & Enter Lobby</span>
              </button>
            </div>
          </div>

          {/* Join Room Card */}
          <div className="duel-card join-card">
            <div className="duel-card-header">
              <div className="duel-card-icon green">
                <LucideIcons.LogIn size={22} color="#22c55e" />
              </div>
              <div>
                <h2>Join a Contest</h2>
                <p>Enter an invitation room code to compete.</p>
              </div>
            </div>

            <form className="duel-card-body" onSubmit={handleJoinRoom}>
              <div className="duel-field">
                <label>
                  <LucideIcons.KeyRound size={14} /> 6-Character Room Code
                </label>
                <input
                  type="text"
                  className="duel-code-input"
                  placeholder="e.g. 7K9X2B"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={8}
                />
              </div>

              <div className="duel-info-box">
                <LucideIcons.Sparkles size={14} color="#9B40E0" />
                <span>Rankings are determined by test cases passed first, then speed (fastest time).</span>
              </div>

              <button type="submit" className="duel-secondary-btn" disabled={!joinCode.trim()}>
                <LucideIcons.ArrowRight size={16} />
                <span>Join Arena</span>
              </button>
            </form>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="duel-features-row">
          <div className="duel-feat-item">
            <div className="feat-icon"><LucideIcons.BrainCircuit size={18} color="#9B40E0" /></div>
            <div>
              <h4>AI Problem Architect</h4>
              <p>Admin can explain any custom problem idea to AI, or pick Easy/Medium/Hard presets.</p>
            </div>
          </div>
          <div className="duel-feat-item">
            <div className="feat-icon"><LucideIcons.Lock size={18} color="#3b82f6" /></div>
            <div>
              <h4>Secret Problem Lock</h4>
              <p>The challenge stays hidden on the server until the 3-2-1 countdown unrolls simultaneously.</p>
            </div>
          </div>
          <div className="duel-feat-item">
            <div className="feat-icon"><LucideIcons.Activity size={18} color="#22c55e" /></div>
            <div>
              <h4>Live Progress Bars</h4>
              <p>Watch opponents pass test cases in real-time with animated progress indicators.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

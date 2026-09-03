import { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import './PodiumModal.css';

export default function PodiumModal({ rankings = [], onLeave, currentUserId }) {
  const [viewingCodePlayer, setViewingCodePlayer] = useState(null);

  const formatTime = (ms) => {
    if (!ms) return '--:--';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const winner = rankings[0];
  const second = rankings[1];
  const third = rankings[2];

  return (
    <div className="duel-modal-backdrop">
      <div className="duel-podium-card">
        {/* Confetti celebration header */}
        <div className="duel-podium-header">
          <div className="duel-trophy-glow">
            <LucideIcons.Trophy size={48} color="#facc15" />
          </div>
          <h2>Contest Finished!</h2>
          <p className="duel-podium-subtitle">
            {winner ? `${winner.username} took 1st Place!` : 'The contest has concluded.'}
          </p>
        </div>

        {/* 3-Pillar Visual Podium */}
        <div className="duel-podium-stage">
          {/* 2nd Place */}
          {second ? (
            <div className="podium-col second">
              <div className="podium-avatar">
                {(second.username || 'P').charAt(0).toUpperCase()}
              </div>
              <span className="podium-name">{second.username}</span>
              <span className="podium-stat">{second.passedTests}/{second.totalTests || 5} tests</span>
              <span className="podium-time">{formatTime(second.finishTime)}</span>
              <div className="podium-pillar pillar-2">
                <span className="podium-medal">🥈</span>
                <span className="podium-rank">2nd</span>
              </div>
            </div>
          ) : (
            <div className="podium-col empty" />
          )}

          {/* 1st Place (Center & Highest) */}
          {winner && (
            <div className="podium-col first">
              <div className="podium-avatar gold-ring">
                {(winner.username || 'P').charAt(0).toUpperCase()}
                <span className="podium-crown">👑</span>
              </div>
              <span className="podium-name">{winner.username}</span>
              <span className="podium-stat">{winner.passedTests}/{winner.totalTests || 5} tests</span>
              <span className="podium-time">{formatTime(winner.finishTime)}</span>
              <div className="podium-pillar pillar-1">
                <span className="podium-medal">🥇</span>
                <span className="podium-rank">1st</span>
              </div>
            </div>
          )}

          {/* 3rd Place */}
          {third ? (
            <div className="podium-col third">
              <div className="podium-avatar">
                {(third.username || 'P').charAt(0).toUpperCase()}
              </div>
              <span className="podium-name">{third.username}</span>
              <span className="podium-stat">{third.passedTests}/{third.totalTests || 5} tests</span>
              <span className="podium-time">{formatTime(third.finishTime)}</span>
              <div className="podium-pillar pillar-3">
                <span className="podium-medal">🥉</span>
                <span className="podium-rank">3rd</span>
              </div>
            </div>
          ) : (
            <div className="podium-col empty" />
          )}
        </div>

        {/* Standings Table for All Players */}
        <div className="duel-podium-table">
          <h3>Full Contest Standings</h3>
          <div className="duel-table-body">
            {rankings.map((p, idx) => (
              <div key={p.id} className={`duel-table-row ${p.id === currentUserId ? 'highlight' : ''}`}>
                <span className="dt-rank">#{idx + 1}</span>
                <span className="dt-name">{p.username} {p.id === currentUserId && '(You)'}</span>
                <span className="dt-tests">{p.passedTests} / {p.totalTests || 5} passed</span>
                <span className="dt-time">{formatTime(p.finishTime)}</span>
                {p.code ? (
                  <button
                    type="button"
                    className="dt-code-btn"
                    onClick={() => setViewingCodePlayer(p)}
                  >
                    <LucideIcons.Code size={12} /> View Code
                  </button>
                ) : (
                  <span className="dt-no-code">--</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Winner Code Viewer Modal */}
        {viewingCodePlayer && (
          <div className="duel-code-submodal">
            <div className="duel-code-content">
              <div className="duel-code-header">
                <span>{viewingCodePlayer.username}'s Solution ({viewingCodePlayer.language || 'javascript'})</span>
                <button type="button" onClick={() => setViewingCodePlayer(null)}>
                  <LucideIcons.X size={15} />
                </button>
              </div>
              <pre className="duel-code-pre">
                <code>{viewingCodePlayer.code || '// No code recorded'}</code>
              </pre>
            </div>
          </div>
        )}

        <div className="duel-podium-actions">
          <button type="button" className="duel-leave-btn" onClick={onLeave}>
            <LucideIcons.LogOut size={14} /> Leave Arena
          </button>
        </div>
      </div>
    </div>
  );
}

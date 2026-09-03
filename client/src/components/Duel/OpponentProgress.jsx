import * as LucideIcons from 'lucide-react';
import './OpponentProgress.css';

export default function OpponentProgress({ players = [], currentUserId, totalTests = 0 }) {
  // Sort players by passed tests descending, then by finish time
  const sorted = [...players].sort((a, b) => {
    if (b.passedTests !== a.passedTests) return b.passedTests - a.passedTests;
    if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
    if (a.finishTime) return -1;
    if (b.finishTime) return 1;
    return (a.lastSubmittedAt || 0) - (b.lastSubmittedAt || 0);
  });

  const formatTime = (ms) => {
    if (!ms) return '';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getRankBadge = (idx, player) => {
    if (player.passedTests === 0 && !player.finishTime) return null;
    if (idx === 0) return <span className="duel-rank-pill gold">🥇 1st</span>;
    if (idx === 1) return <span className="duel-rank-pill silver">🥈 2nd</span>;
    if (idx === 2) return <span className="duel-rank-pill bronze">🥉 3rd</span>;
    return <span className="duel-rank-pill generic">#{idx + 1}</span>;
  };

  return (
    <div className="duel-opponents-card">
      <div className="duel-opponents-header">
        <div className="duel-opponents-title">
          <LucideIcons.Swords size={15} color="#9B40E0" />
          <span>Live Arena Standings</span>
        </div>
        <span className="duel-player-count">{players.length} Players</span>
      </div>

      <div className="duel-opponents-list">
        {sorted.map((player, idx) => {
          const isMe = player.id === currentUserId;
          const isDone = player.status === 'completed';
          const isTesting = player.status === 'testing';
          const percent = player.totalTests > 0
            ? Math.round((player.passedTests / player.totalTests) * 100)
            : 0;

          return (
            <div
              key={player.id}
              className={`duel-player-row ${isMe ? 'is-me' : ''} ${isDone ? 'is-done' : ''}`}
            >
              <div className="duel-player-top">
                <div className="duel-player-info">
                  <div className="duel-player-avatar">
                    {(player.username || 'P').charAt(0).toUpperCase()}
                  </div>
                  <div className="duel-player-name-wrap">
                    <span className="duel-player-name">
                      {player.username}
                      {isMe && <span className="duel-you-tag">YOU</span>}
                      {player.isHost && <span className="duel-host-tag">HOST</span>}
                    </span>
                    <span className="duel-player-status">
                      {isDone ? (
                        <span className="status-done">
                          <LucideIcons.CheckCircle2 size={11} /> Finished ({formatTime(player.finishTime)})
                        </span>
                      ) : isTesting ? (
                        <span className="status-testing">
                          <LucideIcons.Loader2 size={11} className="ide-spin" /> Running tests...
                        </span>
                      ) : (
                        <span className="status-coding">
                          <LucideIcons.Code2 size={11} /> Coding...
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="duel-player-right">
                  {getRankBadge(idx, player)}
                  <span className="duel-test-score">
                    {player.passedTests} / {player.totalTests || totalTests || 5}
                  </span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="duel-progress-track">
                <div
                  className={`duel-progress-fill ${isDone ? 'complete' : ''} ${isTesting ? 'testing' : ''}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

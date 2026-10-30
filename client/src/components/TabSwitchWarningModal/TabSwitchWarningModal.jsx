import React, { useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import './TabSwitchWarningModal.css';

/**
 * TabSwitchWarningModal
 * Displayed when candidate switches tabs, opens another tab, or uses another window during an interview.
 */
function TabSwitchWarningModal({
  isOpen,
  warningCount = 1,
  maxWarnings = 3,
  onAcknowledge,
  onDisqualify,
  violations = [],
  title = 'Tab Switch Detected',
}) {
  const isCritical = warningCount >= maxWarnings;
  const isSecond = warningCount === 2;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        if (isCritical && onDisqualify) {
          onDisqualify();
        } else {
          onAcknowledge?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isCritical, onAcknowledge, onDisqualify]);

  if (!isOpen) return null;

  return (
    <div className="ts-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ts-title">
      <div className={`ts-modal-card ${isCritical ? 'ts-critical' : isSecond ? 'ts-second' : 'ts-initial'}`}>
        
        {/* Glow & Animated Radar Ring */}
        <div className="ts-radar-wrapper">
          <div className="ts-radar-pulse" />
          <div className="ts-icon-circle">
            {isCritical ? (
              <LucideIcons.ShieldAlert size={36} className="ts-icon-alert" />
            ) : isSecond ? (
              <LucideIcons.AlertOctagon size={36} className="ts-icon-alert" />
            ) : (
              <LucideIcons.AlertTriangle size={36} className="ts-icon-alert" />
            )}
          </div>
        </div>

        {/* Badge & Title */}
        <div className="ts-badge-row">
          <span className={`ts-pill-badge ${isCritical ? 'badge-critical' : isSecond ? 'badge-second' : 'badge-warn'}`}>
            <LucideIcons.Shield size={12} />
            <span>
              {isCritical
                ? 'MALPRACTICE DETECTED · SESSION TERMINATED'
                : `PROCTORING ALERT · VIOLATION ${warningCount} OF ${maxWarnings}`}
            </span>
          </span>
        </div>

        <h2 id="ts-title" className="ts-modal-title">
          {isCritical ? 'Interview Disqualified' : title}
        </h2>

        <p className="ts-modal-desc">
          {isCritical
            ? 'You have reached the maximum threshold of 3 tab/window switch warnings. You cannot continue this session.'
            : 'Navigating away from the interview tab, opening new tabs, or using other windows is strictly monitored.'}
        </p>

        {/* Severity Banner */}
        <div className={`ts-notice-box ${isCritical ? 'box-critical' : isSecond ? 'box-second' : 'box-warn'}`}>
          <div className="ts-notice-icon">
            {isCritical ? <LucideIcons.Flame size={18} /> : <LucideIcons.Info size={18} />}
          </div>
          <div className="ts-notice-text">
            {isCritical ? (
              <>
                <strong>Immediate Disqualification:</strong> You have exceeded the 3 allowed warning limit. This assessment has been permanently terminated and recorded as disqualified due to malpractice.
              </>
            ) : isSecond ? (
              <>
                <strong>Final Warning:</strong> You have 1 remaining warning before immediate disqualification and assessment termination.
              </>
            ) : (
              <>
                <strong>First Warning:</strong> Please keep this tab active and in focus. Switching applications or browser tabs during the test violates assessment integrity.
              </>
            )}
          </div>
        </div>

        {/* Recent Violations Snippet */}
        {violations && violations.length > 0 && (
          <div className="ts-violations-list">
            <div className="ts-violations-header">
              <LucideIcons.Clock size={12} />
              <span>Incident Log ({violations.length})</span>
            </div>
            <div className="ts-violations-body">
              {violations.slice(0, 3).map((v) => (
                <div key={v.id} className="ts-violation-item">
                  <span className="ts-v-num">#{v.count}</span>
                  <span className="ts-v-time">{v.timestamp}</span>
                  <span className="ts-v-reason">{v.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Button */}
        {isCritical ? (
          <button
            type="button"
            className="ts-acknowledge-btn ts-disqualified-btn"
            onClick={onDisqualify || onAcknowledge}
            autoFocus
          >
            <LucideIcons.Ban size={16} />
            <span>Session Terminated — View Disqualification</span>
          </button>
        ) : (
          <button
            type="button"
            className="ts-acknowledge-btn"
            onClick={onAcknowledge}
            autoFocus
          >
            <LucideIcons.CheckCircle2 size={16} />
            <span>I Understand & Resume Interview</span>
          </button>
        )}

        <div className="ts-footnote">
          <LucideIcons.Lock size={11} />
          <span>Apollo Proctoring & Assessment Integrity System</span>
        </div>
      </div>
    </div>
  );
}

export default TabSwitchWarningModal;

import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';

/**
 * Custom hook to detect when a user leaves the current tab,
 * opens another tab, minimizes the window, or switches to another window/app.
 *
 * @param {Object} options
 * @param {boolean} options.isActive - Whether detection is enabled (e.g. during active interview)
 * @param {number} options.maxWarnings - Maximum warnings before critical status
 * @param {boolean} options.alertSound - Whether to play a synthesized warning beep
 * @param {Function} options.onTabSwitch - Callback fired on each new tab/window switch
 */
export function useTabFocusTracker({
  isActive = false,
  maxWarnings = 3,
  alertSound = true,
  onTabSwitch,
  onDisqualify,
} = {}) {
  const [warningCount, setWarningCount] = useState(0);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [violations, setViolations] = useState([]);
  const [isCurrentlyAway, setIsCurrentlyAway] = useState(false);

  const isAwayRef = useRef(false);
  const lastTriggerTimeRef = useRef(0);
  const originalTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');
  const titleFlashIntervalRef = useRef(null);
  const warningCountRef = useRef(warningCount);
  warningCountRef.current = warningCount;

  // Synthesized audio alert (no external mp3 file required)
  const playWarningBeep = useCallback(() => {
    if (!alertSound || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      // Urgent two-tone chime
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio autoplay policy can occasionally block until user interaction
    }
  }, [alertSound]);

  // Flash title while user is in another tab
  const startTitleFlash = useCallback(() => {
    if (titleFlashIntervalRef.current) return;
    originalTitleRef.current = document.title;
    let toggle = false;
    titleFlashIntervalRef.current = setInterval(() => {
      document.title = toggle ? '⚠️ RETURN TO INTERVIEW!' : '🚨 TAB SWITCH DETECTED!';
      toggle = !toggle;
    }, 750);
  }, []);

  const stopTitleFlash = useCallback(() => {
    if (titleFlashIntervalRef.current) {
      clearInterval(titleFlashIntervalRef.current);
      titleFlashIntervalRef.current = null;
    }
    if (originalTitleRef.current) {
      document.title = originalTitleRef.current;
    }
  }, []);

  // Handler when user leaves window/tab
  const handleLeave = useCallback((source) => {
    if (!isActive) return;

    const now = Date.now();
    // Debounce guard: tab change often triggers both 'blur' and 'visibilitychange' within ms
    if (now - lastTriggerTimeRef.current < 1200) {
      return;
    }

    lastTriggerTimeRef.current = now;
    isAwayRef.current = true;
    setIsCurrentlyAway(true);

    const newCount = warningCountRef.current + 1;
    const violation = {
      id: now,
      count: newCount,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      reason: source === 'visibility' ? 'Switched tab or minimized browser' : 'Window lost focus / switched app'
    };

    const isDisqualified = newCount >= maxWarnings;

    setWarningCount(newCount);
    setViolations((prev) => [violation, ...prev]);
    setShowWarningModal(true);

    playWarningBeep();
    startTitleFlash();

    if (isDisqualified) {
      toast.error(
        `🚨 INTERVIEW DISQUALIFIED: Reached ${newCount} tab switch warnings! Session terminated immediately.`,
        {
          id: 'tab-switch-disqualified-toast',
          duration: 7000,
          style: {
            background: '#20080b',
            color: '#ff8585',
            border: '1px solid #ef4444',
            fontWeight: 700,
            fontSize: '13px',
          }
        }
      );
      if (onDisqualify) {
        try {
          onDisqualify({
            count: newCount,
            maxWarnings,
            violation,
            timestamp: violation.timestamp
          });
        } catch (err) {
          console.error('Error in onDisqualify callback:', err);
        }
      }
    } else {
      toast.error(
        `⚠️ Warning #${newCount}: Tab/Window switch detected! Please stay on this tab during the interview.`,
        {
          id: 'tab-switch-warning-toast',
          duration: 4500,
          style: {
            background: '#1e1014',
            color: '#ff6b6b',
            border: '1px solid #f85149',
            fontWeight: 600,
            fontSize: '13px',
          }
        }
      );
    }

    if (onTabSwitch) {
      try {
        onTabSwitch({
          count: newCount,
          maxWarnings,
          violation,
          isDisqualified,
          timestamp: violation.timestamp
        });
      } catch (err) {
        console.error('Error in onTabSwitch callback:', err);
      }
    }
  }, [isActive, maxWarnings, onTabSwitch, onDisqualify, playWarningBeep, startTitleFlash]);

  // Handler when user returns to window/tab
  const handleReturn = useCallback(() => {
    isAwayRef.current = false;
    setIsCurrentlyAway(false);
    stopTitleFlash();
  }, [stopTitleFlash]);

  useEffect(() => {
    if (!isActive) {
      stopTitleFlash();
      return;
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        handleLeave('visibility');
      } else {
        handleReturn();
      }
    };

    const onBlur = () => {
      handleLeave('blur');
    };

    const onFocus = () => {
      handleReturn();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      stopTitleFlash();
    };
  }, [isActive, handleLeave, handleReturn, stopTitleFlash]);

  const dismissModal = useCallback(() => {
    setShowWarningModal(false);
    stopTitleFlash();
  }, [stopTitleFlash]);

  const resetWarnings = useCallback(() => {
    setWarningCount(0);
    setViolations([]);
    setShowWarningModal(false);
    isAwayRef.current = false;
    setIsCurrentlyAway(false);
    stopTitleFlash();
  }, [stopTitleFlash]);

  return {
    warningCount,
    isDisqualified: warningCount >= maxWarnings,
    showWarningModal,
    setShowWarningModal,
    violations,
    isCurrentlyAway,
    dismissModal,
    resetWarnings,
  };
}

export default useTabFocusTracker;

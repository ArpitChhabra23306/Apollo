import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import * as LucideIcons from 'lucide-react';
import CodeEditor from '../components/CodeEditor/CodeEditor';
import TabSwitchWarningModal from '../components/TabSwitchWarningModal/TabSwitchWarningModal';
import useTabFocusTracker from '../hooks/useTabFocusTracker';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../services/api';
import './Interview.css';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
];

function FormalInterview() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // `host=true` indicates the user is the Interviewer who created the room
  const isHost = searchParams.get('host') === 'true';
  const role = isHost ? 'Interviewer' : 'Student';
  const { user } = useAuth();

  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micMuted, setMicMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [peerWarnings, setPeerWarnings] = useState(0);
  const [peerDisqualified, setPeerDisqualified] = useState(false);

  // ── Tab & Window Focus Tracking ──
  const {
    warningCount,
    isDisqualified,
    showWarningModal,
    setShowWarningModal,
    violations,
    dismissModal,
  } = useTabFocusTracker({
    isActive: true,
    maxWarnings: 3,
    alertSound: true,
    onTabSwitch: ({ count, violation }) => {
      if (socketRef.current) {
        socketRef.current.emit(
          'tab-switch-warning',
          {
            user: user?.username || (isHost ? 'Interviewer' : 'Candidate'),
            role,
            count,
            timestamp: violation?.timestamp || new Date().toLocaleTimeString(),
          },
          roomId
        );
      }
    },
    onDisqualify: ({ count, violation }) => {
      if (socketRef.current) {
        socketRef.current.emit(
          'candidate-disqualified',
          {
            user: user?.username || (isHost ? 'Interviewer' : 'Candidate'),
            role,
            count,
            timestamp: violation?.timestamp || new Date().toLocaleTimeString(),
          },
          roomId
        );
      }
    },
  });
  
  const [code, setCode] = useState('// Write your code here...\n');
  const [language, setLanguage] = useState('javascript');
  const [question, setQuestion] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const codeRef = useRef(code);
  const langRef = useRef(language);
  const questionRef = useRef(question);

  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => { langRef.current = language; }, [language]);
  useEffect(() => { questionRef.current = question; }, [question]);

  // Initialize Socket and Media
  useEffect(() => {
    const s = io(API_BASE);
    setSocket(s);
    socketRef.current = s;

    // Get Local Media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // Join room after media is ready
        s.emit('join-room', roomId, s.id);
      })
      .catch(err => {
        console.error('Failed to get media devices:', err);
        // Even if media fails, still join so they can see code
        s.emit('join-room', roomId, s.id);
      });

    // ── WebRTC Signaling Logic ──
    const createPeerConnection = () => {
      const pc = new RTCPeerConnection(rtcConfig);
      
      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          s.emit('ice-candidate', event.candidate, roomId);
        }
      };

      return pc;
    };

    s.on('user-connected', async (userId, socketId) => {
      console.log('User connected:', userId);
      // The person already in the room creates the offer
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      s.emit('offer', offer, roomId);

      // Sync current state to the new user
      s.emit('code-change', codeRef.current, roomId);
      s.emit('language-change', langRef.current, roomId);
      s.emit('question-update', questionRef.current, roomId);
    });

    s.on('offer', async (offer, socketId) => {
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit('answer', answer, roomId);
    });

    s.on('answer', async (answer) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    s.on('ice-candidate', async (candidate) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    });

    s.on('user-disconnected', () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setRemoteStream(null);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    });

    // ── Synchronization Logic ──
    s.on('code-change', (newCode) => setCode(newCode));
    s.on('language-change', (newLang) => setLanguage(newLang));
    s.on('question-update', (newQ) => setQuestion(newQ));

    // ── Proctoring & Tab Switch Alert ──
    s.on('tab-switch-warning', (data) => {
      setPeerWarnings(data.count);
      toast.error(
        `⚠️ ${data.role || data.user} navigated away from the interview tab! (Warning #${data.count})`,
        {
          id: `tab-switch-peer-${data.count}`,
          duration: 5000,
          style: {
            background: '#1e1014',
            color: '#f87171',
            border: '1px solid #ef4444',
            fontWeight: 600,
            fontSize: '13px',
          },
        }
      );
    });

    s.on('candidate-disqualified', (data) => {
      setPeerDisqualified(true);
      setPeerWarnings(3);
      toast.error(
        `🚨 ${data.role || data.user} has been DISQUALIFIED! Reached 3 tab switch warnings.`,
        {
          id: 'candidate-disqualified-toast',
          duration: 8000,
          style: {
            background: '#20080b',
            color: '#ff8585',
            border: '1px solid #ef4444',
            fontWeight: 700,
            fontSize: '13px',
          },
        }
      );
    });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      s.disconnect();
    };
  }, [roomId]); // Deliberately omit other deps to run only once

  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoOff(!videoTrack.enabled);
      }
    }
  };

  const handleCopyLink = () => {
    // Generate the invite link (without ?host=true so the joiner defaults to Student)
    const link = `${window.location.origin}/interview/join/${roomId}`;
    navigator.clipboard.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  const handleLeave = () => {
    if (window.confirm('Are you sure you want to leave the interview room?')) {
      navigate('/interview');
    }
  };

  return (
    <div className="iv-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d12', color: '#fff' }}>
      
      {/* HEADER */}
      <header style={{ height: '60px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <LucideIcons.Sparkles color="#9B40E0" size={20} />
          <h2 style={{ fontSize: '20px', margin: 0, fontFamily: 'var(--ws-font-display, "Playfair Display", serif)', fontStyle: 'italic', fontWeight: 400 }}>Formal Interview ({role})</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Proctoring Status Pill */}
          <div 
            className={`iv-proctor-pill ${warningCount > 0 ? 'warning' : 'clean'}`}
            onClick={() => warningCount > 0 && setShowWarningModal(true)}
            title={warningCount > 0 ? `${warningCount} warnings logged. Click to view.` : 'Proctoring active: Tab & window switching is monitored'}
            style={{ cursor: warningCount > 0 ? 'pointer' : 'default' }}
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

          {isHost && (
            <button onClick={handleCopyLink} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#2d2d3a', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--ws-font-body)', fontSize: '13px' }}>
              <LucideIcons.Copy size={14} /> Copy Invite
            </button>
          )}
          <button onClick={handleLeave} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f85149', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--ws-font-body)', fontSize: '13px' }}>
            <LucideIcons.LogOut size={14} /> Leave
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* LEFT COLUMN: Question & Video */}
        <div style={{ width: '350px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', background: '#15151c' }}>
          
          {/* Question Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #333' }}>
            <div style={{ padding: '12px 16px', background: '#1e1e24', borderBottom: '1px solid #333', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LucideIcons.FileText size={14} /> Question Details
            </div>
            {isHost ? (
              <textarea 
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  socketRef.current?.emit('question-update', e.target.value, roomId);
                }}
                placeholder="Type or paste the problem description here for the student..."
                style={{ flex: 1, padding: '16px', background: 'transparent', border: 'none', color: '#ccc', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
              />
            ) : (
              <div style={{ flex: 1, padding: '16px', color: '#ccc', whiteSpace: 'pre-wrap', overflowY: 'auto' }}>
                {question || <span style={{ color: '#666', fontStyle: 'italic' }}>Waiting for interviewer to provide the question...</span>}
              </div>
            )}
          </div>

          {/* Video Calls */}
          <div style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 16px', background: '#1e1e24', borderBottom: '1px solid #333', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LucideIcons.Video size={14} /> Video Call
            </div>
            
            <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
              {/* Remote Video */}
              <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {!remoteStream && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '13px' }}>
                    Waiting for peer...
                  </div>
                )}
                <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{isHost ? 'Student' : 'Interviewer'}</span>
                  {peerDisqualified ? (
                    <span style={{ color: '#fff', background: '#dc2626', padding: '1px 6px', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 700, fontSize: '10px' }}>
                      <LucideIcons.Ban size={10} /> DISQUALIFIED
                    </span>
                  ) : peerWarnings > 0 ? (
                    <span style={{ color: '#fbbf24', background: 'rgba(245, 158, 11, 0.25)', padding: '1px 5px', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                      <LucideIcons.AlertTriangle size={10} /> {peerWarnings} tab switch{peerWarnings > 1 ? 'es' : ''}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Local Video */}
              <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
                  You ({role})
                </div>
                
                {/* Media Controls Overlay */}
                <div style={{ position: 'absolute', bottom: '8px', right: '8px', display: 'flex', gap: '6px' }}>
                  <button onClick={toggleMic} style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: micMuted ? '#f85149' : 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {micMuted ? <LucideIcons.MicOff size={14} /> : <LucideIcons.Mic size={14} />}
                  </button>
                  <button onClick={toggleVideo} style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: videoOff ? '#f85149' : 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {videoOff ? <LucideIcons.VideoOff size={14} /> : <LucideIcons.Video size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Code Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 16px', background: '#1e1e24', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LucideIcons.Code2 size={14} /> Collaborative Editor
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>Language:</span>
              <select 
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  socketRef.current?.emit('language-change', e.target.value, roomId);
                }}
                style={{ background: '#2d2d3a', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '4px 8px', fontSize: '12px' }}
              >
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <CodeEditor 
              value={code} 
              readOnly={isDisqualified || peerDisqualified}
              onChange={(newCode) => {
                if (isDisqualified || peerDisqualified) return;
                setCode(newCode);
                socketRef.current?.emit('code-change', newCode, roomId);
              }} 
              language={language} 
              theme="vs-dark" 
            />
          </div>
        </div>
      </main>

      {/* Disqualification Banners */}
      {isDisqualified && (
        <div style={{ background: 'rgba(239, 68, 68, 0.25)', borderTop: '1px solid #ef4444', color: '#ff8585', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LucideIcons.ShieldAlert size={18} color="#ef4444" />
            <span>INTERVIEW TERMINATED: You were disqualified for exceeding 3 tab/window switch warnings. Code editor has been locked.</span>
          </div>
          <button onClick={handleLeave} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
            Leave Interview
          </button>
        </div>
      )}

      {peerDisqualified && !isDisqualified && (
        <div style={{ background: 'rgba(239, 68, 68, 0.25)', borderTop: '1px solid #ef4444', color: '#ff8585', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
          <LucideIcons.ShieldAlert size={18} color="#ef4444" />
          <span>CANDIDATE DISQUALIFIED: {isHost ? 'The student' : 'The candidate'} exceeded 3 tab switch violations and has been disqualified. Code collaboration is locked.</span>
        </div>
      )}

      <TabSwitchWarningModal
        isOpen={showWarningModal}
        warningCount={warningCount}
        maxWarnings={3}
        onAcknowledge={dismissModal}
        onDisqualify={() => setShowWarningModal(false)}
        violations={violations}
      />
    </div>
  );
}

export default FormalInterview;

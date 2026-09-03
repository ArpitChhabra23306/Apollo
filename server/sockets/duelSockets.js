import { evaluateDuelSubmission } from '../services/duelRunner.js';

// In-memory rooms repository
const duelRooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function calculateRankings(players) {
  return [...players].sort((a, b) => {
    // 1. More test cases passed wins
    if (b.passedTests !== a.passedTests) {
      return b.passedTests - a.passedTests;
    }
    // 2. If test cases passed are equal:
    // If both finished 100%, lower finishTime wins
    if (a.finishTime && b.finishTime) {
      return a.finishTime - b.finishTime;
    }
    // If one finished 100% and other didn't
    if (a.finishTime && !b.finishTime) return -1;
    if (!a.finishTime && b.finishTime) return 1;

    // Tie breaker: who reached this score earlier
    return (a.lastSubmittedAt || 0) - (b.lastSubmittedAt || 0);
  });
}

export default function initDuelSockets(io) {
  const duelNamespace = io.of('/duel');

  duelNamespace.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // ── 1. Create Room ──
    socket.on('duel:create-room', ({ user, maxPlayers = 2, durationMinutes = 30, roomId: requestedRoomId }) => {
      const roomId = requestedRoomId ? requestedRoomId.toUpperCase().trim() : generateRoomCode();
      const hostPlayer = {
        id: user?.id || user?._id || socket.id,
        socketId: socket.id,
        username: user?.username || 'Host',
        avatar: user?.avatar || null,
        isHost: true,
        passedTests: 0,
        totalTests: 0,
        progressPercent: 0,
        status: 'ready', // 'ready' | 'coding' | 'testing' | 'completed'
        finishTime: null,
        lastSubmittedAt: null,
      };

      const room = {
        id: roomId,
        hostId: hostPlayer.id,
        maxPlayers: Math.min(Math.max(Number(maxPlayers) || 2, 2), 5), // max 5
        durationSeconds: (Number(durationMinutes) || 30) * 60,
        players: [hostPlayer],
        problem: null, // Hidden until countdown!
        status: 'waiting', // 'waiting' | 'countdown' | 'active' | 'finished'
        startTime: null,
        createdAt: Date.now(),
      };

      duelRooms.set(roomId, room);
      currentRoomId = roomId;
      currentUser = hostPlayer;

      socket.join(roomId);
      socket.emit('duel:room-created', { roomId, room });
      console.log(`[Duel] Room ${roomId} created by ${hostPlayer.username} (max ${room.maxPlayers})`);
    });

    // ── 2. Join Room ──
    socket.on('duel:join-room', ({ roomId, user }) => {
      const cleanRoomId = (roomId || '').toUpperCase().trim();
      const room = duelRooms.get(cleanRoomId);

      if (!room) {
        return socket.emit('duel:error', { message: `Contest room "${cleanRoomId}" not found.` });
      }

      if (room.status !== 'waiting') {
        return socket.emit('duel:error', { message: 'Contest is already in progress or completed.' });
      }

      const existingPlayer = room.players.find(
        (p) => p.id === (user?.id || user?._id) || p.socketId === socket.id
      );

      if (!existingPlayer && room.players.length >= room.maxPlayers) {
        return socket.emit('duel:error', { message: `Room is full (Maximum ${room.maxPlayers} players).` });
      }

      let player = existingPlayer;
      if (!player) {
        player = {
          id: user?.id || user?._id || socket.id,
          socketId: socket.id,
          username: user?.username || `Contestant ${room.players.length + 1}`,
          avatar: user?.avatar || null,
          isHost: false,
          passedTests: 0,
          totalTests: 0,
          progressPercent: 0,
          status: 'ready',
          finishTime: null,
          lastSubmittedAt: null,
        };
        room.players.push(player);
      } else {
        player.socketId = socket.id;
      }

      currentRoomId = cleanRoomId;
      currentUser = player;

      socket.join(cleanRoomId);

      // Sanitize room data for contestants: DO NOT leak the problem before start!
      const sanitizedRoom = {
        ...room,
        problem: room.status === 'active' || room.status === 'finished' ? room.problem : null,
        hasProblemSet: !!room.problem,
        problemMeta: room.problem
          ? { title: room.problem.title, difficulty: room.problem.difficulty, topic: room.problem.topic }
          : null,
      };

      duelNamespace.to(cleanRoomId).emit('duel:room-updated', sanitizedRoom);
      console.log(`[Duel] ${player.username} joined room ${cleanRoomId} (${room.players.length}/${room.maxPlayers})`);
    });

    // ── 3. Host Sets Problem ──
    socket.on('duel:set-problem', ({ roomId, problem }) => {
      const cleanRoomId = (roomId || '').toUpperCase().trim();
      const room = duelRooms.get(cleanRoomId);
      if (!room) return socket.emit('duel:error', { message: 'Room not found.' });

      if (room.hostId !== (currentUser?.id || socket.id)) {
        return socket.emit('duel:error', { message: 'Only the host can configure the contest problem.' });
      }

      room.problem = problem;

      // Host gets confirmation with full problem
      socket.emit('duel:problem-set-success', { problem });

      // Contestants only get metadata so it remains secret until start!
      socket.to(cleanRoomId).emit('duel:problem-ready', {
        title: problem.title,
        difficulty: problem.difficulty,
        topic: problem.topic,
        timeLimitMinutes: problem.timeLimitMinutes,
      });

      console.log(`[Duel] Problem "${problem.title}" set by host for room ${cleanRoomId}`);
    });

    // ── 4. Host Starts Contest ──
    socket.on('duel:start-contest', ({ roomId }) => {
      const cleanRoomId = (roomId || '').toUpperCase().trim();
      const room = duelRooms.get(cleanRoomId);
      if (!room) return socket.emit('duel:error', { message: 'Room not found.' });

      if (room.hostId !== (currentUser?.id || socket.id)) {
        return socket.emit('duel:error', { message: 'Only the host can start the contest.' });
      }

      if (!room.problem) {
        return socket.emit('duel:error', { message: 'Please set or generate a problem first before starting.' });
      }

      if (room.players.length < 2) {
        return socket.emit('duel:error', { message: 'At least 2 players are required to start a duel contest.' });
      }

      room.status = 'countdown';

      // 3-second synchronized countdown
      let count = 3;
      duelNamespace.to(cleanRoomId).emit('duel:countdown-tick', { count });

      const countdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
          duelNamespace.to(cleanRoomId).emit('duel:countdown-tick', { count });
        } else {
          clearInterval(countdownInterval);
          room.status = 'active';
          room.startTime = Date.now();

          // UNLOCK PROBLEM TO ALL CONTESTANTS SIMULTANEOUSLY!
          duelNamespace.to(cleanRoomId).emit('duel:contest-started', {
            problem: room.problem,
            startTime: room.startTime,
            durationSeconds: room.durationSeconds,
          });

          console.log(`[Duel] Contest started in room ${cleanRoomId}! Problem unlocked for all ${room.players.length} players.`);
        }
      }, 1000);
    });

    // ── 5. Run / Submit Code ──
    socket.on('duel:submit-code', async ({ roomId, code, language, sampleOnly = false }) => {
      const cleanRoomId = (roomId || '').toUpperCase().trim();
      const room = duelRooms.get(cleanRoomId);
      if (!room || !room.problem) {
        return socket.emit('duel:test-results', { ok: false, error: 'Room or problem not found' });
      }

      const player = room.players.find((p) => p.socketId === socket.id || p.id === currentUser?.id);
      if (!player) return;

      if (!sampleOnly) {
        player.status = 'testing';
        duelNamespace.to(cleanRoomId).emit('duel:player-status-update', {
          playerId: player.id,
          status: 'testing',
        });
      }

      // Execute code in sandbox against test suite
      const evalResult = await evaluateDuelSubmission({
        code,
        language,
        problem: room.problem,
        sampleOnly,
      });

      // Send execution results back to the individual player
      socket.emit('duel:test-results', evalResult);

      // If this was a full submission (not just sample test check), update leaderboard & progress bar!
      if (!sampleOnly) {
        player.passedTests = evalResult.passedCount;
        player.totalTests = evalResult.totalCount;
        player.progressPercent = evalResult.totalCount > 0
          ? Math.round((evalResult.passedCount / evalResult.totalCount) * 100)
          : 0;
        player.lastSubmittedAt = Date.now();
        player.code = code;
        player.language = language;

        if (evalResult.isAllPassed && !player.finishTime) {
          player.finishTime = Date.now() - (room.startTime || Date.now());
          player.status = 'completed';
        } else {
          player.status = 'coding';
        }

        const rankings = calculateRankings(room.players);

        // Broadcast live progress bars & leaderboard to all contestants
        duelNamespace.to(cleanRoomId).emit('duel:progress-broadcast', {
          players: room.players,
          rankings,
          updatedPlayer: player,
        });

        // Check if all players have completed!
        const allCompleted = room.players.every((p) => p.status === 'completed');
        if (allCompleted) {
          room.status = 'finished';
          duelNamespace.to(cleanRoomId).emit('duel:contest-finished', {
            rankings,
            finishedReason: 'all_completed',
          });
        }
      }
    });

    // ── 6. Host Ends Contest Early ──
    socket.on('duel:end-contest', ({ roomId }) => {
      const cleanRoomId = (roomId || '').toUpperCase().trim();
      const room = duelRooms.get(cleanRoomId);
      if (!room) return;
      if (room.hostId !== (currentUser?.id || socket.id)) return;

      room.status = 'finished';
      const rankings = calculateRankings(room.players);
      duelNamespace.to(cleanRoomId).emit('duel:contest-finished', {
        rankings,
        finishedReason: 'host_ended',
      });
    });

    // ── 7. Disconnect / Leave ──
    const handleLeave = () => {
      if (!currentRoomId) return;
      const room = duelRooms.get(currentRoomId);
      if (!room) return;

      room.players = room.players.filter((p) => p.socketId !== socket.id);
      socket.leave(currentRoomId);

      if (room.players.length === 0) {
        duelRooms.delete(currentRoomId);
        console.log(`[Duel] Room ${currentRoomId} destroyed (all left)`);
      } else {
        // If host left, pass host status to next player
        if (room.hostId === (currentUser?.id || socket.id)) {
          room.players[0].isHost = true;
          room.hostId = room.players[0].id;
        }

        duelNamespace.to(currentRoomId).emit('duel:room-updated', {
          ...room,
          problem: room.status === 'active' || room.status === 'finished' ? room.problem : null,
          hasProblemSet: !!room.problem,
        });
      }
    };

    socket.on('duel:leave-room', handleLeave);
    socket.on('disconnect', handleLeave);
  });
}

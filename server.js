// server.js - SCOUT 联机游戏服务器入口

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ScoutGame = require('./game/scoutGame');
const ScoutAI = require('./game/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// 托管静态前端资源
app.use(express.static(path.join(__dirname, 'public')));

// 房间管理器：roomId -> { game, botTimers }
const rooms = new Map();

// 生成4位大写随机房间号
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 广播游戏状态（每个客户端接收带私人手牌掩码的视角）
function broadcastGameState(roomId) {
  const roomData = rooms.get(roomId);
  if (!roomData) return;
  const { game } = roomData;

  // 向房间内的每个真实玩家发送其专属状态
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  if (socketsInRoom) {
    for (const socketId of socketsInRoom) {
      const clientState = game.getClientState(socketId);
      io.to(socketId).emit('game_state_update', clientState);
    }
  }

  // 检查是否需要触发 AI 动作
  handleAITurn(roomId);
}

// 自动处理电脑玩家行动
function handleAITurn(roomId) {
  const roomData = rooms.get(roomId);
  if (!roomData) return;
  const { game } = roomData;

  // 1. 准备阶段：让未准备的机器人执行准备
  if (game.phase === 'PREPARE') {
    const unreadyBots = game.players.filter(p => p.isBot && !p.isReady);
    if (unreadyBots.length > 0) {
      setTimeout(() => {
        unreadyBots.forEach(bot => {
          ScoutAI.decidePrepare(game, bot);
        });
        broadcastGameState(roomId);
      }, 600);
    }
    return;
  }

  // 2. 游戏阶段：如果轮到机器人行动
  if (game.phase === 'PLAYING') {
    const activePlayer = game.players[game.activePlayerIndex];
    if (activePlayer && activePlayer.isBot) {
      // 防止重复调度
      if (roomData.aiThinking) return;
      roomData.aiThinking = true;

      setTimeout(() => {
        roomData.aiThinking = false;
        // 双重检验游戏状态与当前出牌人
        if (game.phase === 'PLAYING') {
          const currentActive = game.players[game.activePlayerIndex];
          if (currentActive && currentActive.id === activePlayer.id) {
            ScoutAI.decideTurn(game, activePlayer);
            broadcastGameState(roomId);
          }
        }
      }, 1000 + Math.random() * 500); // 1~1.5秒拟真思考时间
    }
  }
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  // 创建房间
  socket.on('create_room', ({ playerName }) => {
    let roomId = generateRoomCode();
    while (rooms.has(roomId)) {
      roomId = generateRoomCode();
    }

    const game = new ScoutGame(roomId);
    game.addPlayer(socket.id, playerName || '房主');
    rooms.set(roomId, { game, aiThinking: false });

    currentRoomId = roomId;
    socket.join(roomId);
    socket.emit('room_joined', { roomId, isHost: true });
    broadcastGameState(roomId);
  });

  // 加入房间
  socket.on('join_room', ({ roomId, playerName }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const roomData = rooms.get(cleanRoomId);

    if (!roomData) {
      return socket.emit('error_message', '找不到指定的房间号！');
    }

    const { game } = roomData;
    if (game.phase !== 'LOBBY') {
      return socket.emit('error_message', '该房间游戏已经开始，无法中途加入！');
    }

    if (game.players.length >= 5) {
      return socket.emit('error_message', '房间人数已满（最多5人）！');
    }

    const name = playerName || `玩家${game.players.length + 1}`;
    game.addPlayer(socket.id, name);

    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);
    socket.emit('room_joined', { roomId: cleanRoomId, isHost: false });
    broadcastGameState(cleanRoomId);
  });

  // 添加电脑玩家
  socket.on('add_bot', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const { game } = roomData;

    // 只有房主可以添加电脑
    if (game.players.length === 0 || game.players[0].id !== socket.id) return;
    if (game.players.length >= 5) {
      return socket.emit('error_message', '房间已满，无法再添加电脑！');
    }

    const botNames = ['马戏小丑 🤡', '魔术大师 🎩', '驯兽达人 🦁', '空中飞人 🎪', '火焰行者 🔥'];
    const usedNames = new Set(game.players.map(p => p.name));
    const availableName = botNames.find(n => !usedNames.has(n)) || `电脑${game.players.length}`;

    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    game.addPlayer(botId, availableName, true);
    broadcastGameState(currentRoomId);
  });

  // 移除电脑玩家
  socket.on('remove_bot', ({ botId }) => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const { game } = roomData;
    if (game.players.length === 0 || game.players[0].id !== socket.id) return;

    game.removePlayer(botId);
    broadcastGameState(currentRoomId);
  });

  // 开始游戏 (房主)
  socket.on('start_game', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const { game } = roomData;
    if (game.players[0].id !== socket.id) return;

    if (game.players.length < 2) {
      return socket.emit('error_message', '至少需要 2 名玩家（或电脑）才能开始游戏！');
    }

    game.startNewGame();
    broadcastGameState(currentRoomId);
  });

  // 准备阶段：翻转整副手牌
  socket.on('flip_hand', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const res = roomData.game.flipHand(socket.id);
    if (!res.success) {
      socket.emit('error_message', res.msg);
    } else {
      broadcastGameState(currentRoomId);
    }
  });

  // 准备阶段：玩家点击就绪
  socket.on('ready', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const res = roomData.game.setReady(socket.id);
    if (!res.success) {
      socket.emit('error_message', res.msg);
    } else {
      broadcastGameState(currentRoomId);
    }
  });

  // 玩家行动：演出 (Show)
  socket.on('action_show', ({ selectedIndices }) => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const res = roomData.game.playShow(socket.id, selectedIndices);
    if (!res.success) {
      socket.emit('error_message', res.msg);
    } else {
      broadcastGameState(currentRoomId);
    }
  });

  // 玩家行动：挖角 (Scout)
  socket.on('action_scout', ({ side, flip, insertIndex }) => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const res = roomData.game.playScout(socket.id, side, flip, insertIndex);
    if (!res.success) {
      socket.emit('error_message', res.msg);
    } else {
      broadcastGameState(currentRoomId);
    }
  });

  // 玩家行动：挖角并演出 (Scout & Show)
  socket.on('action_scout_and_show', ({ scoutData, showIndices }) => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const res = roomData.game.playScoutAndShow(socket.id, scoutData, showIndices);
    if (!res.success) {
      socket.emit('error_message', res.msg);
    } else {
      broadcastGameState(currentRoomId);
    }
  });

  // 进入下一轮 (房主)
  socket.on('next_round', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const { game } = roomData;
    if (game.players[0].id !== socket.id) return;
    if (game.phase !== 'ROUND_OVER') return;

    game.startRound();
    broadcastGameState(currentRoomId);
  });

  // 重新开始整场游戏 (房主)
  socket.on('restart_game', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;
    const { game } = roomData;
    if (game.players[0].id !== socket.id) return;

    game.startNewGame();
    broadcastGameState(currentRoomId);
  });

  // 断开连接
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const roomData = rooms.get(currentRoomId);
    if (!roomData) return;

    const { game } = roomData;
    game.removePlayer(socket.id);

    // 如果房间空了，销毁房间
    const remainingRealPlayers = game.players.filter(p => !p.isBot);
    if (remainingRealPlayers.length === 0) {
      rooms.delete(currentRoomId);
    } else {
      broadcastGameState(currentRoomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎪《马戏星探》(SCOUT) 联机服务器已启动！`);
  console.log(`📡 本地访问地址: http://localhost:${PORT}`);
  console.log(`===============================================`);
});

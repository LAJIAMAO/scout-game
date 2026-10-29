// scoutGame.js - SCOUT 完整对局状态机与游戏流程控制

const { prepareDeckAndDeal } = require('./cards');
const { analyzeCombo, canBeat, isContiguous } = require('./rules');

class ScoutGame {
  constructor(roomId, options = {}) {
    this.roomId = roomId;
    this.players = []; // { id, name, isBot, hand, scorePile, scoutChips, hasScoutAndShow, isReady, roundScore, totalScore }
    this.phase = 'LOBBY'; // LOBBY, PREPARE, PLAYING, ROUND_OVER, GAME_OVER
    this.round = 0;
    this.maxRounds = options.maxRounds || 3;
    this.startingPlayerIndex = 0;
    this.activePlayerIndex = 0;
    this.currentShow = null; // { cards: Card[], combo: {}, playerId, playerName }
    this.consecutiveScouts = 0;
    this.actionLogs = [];
    this.lastRoundResult = null;
  }

  addLog(msg) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.actionLogs.unshift(`[${timestamp}] ${msg}`);
    if (this.actionLogs.length > 50) {
      this.actionLogs.pop();
    }
  }

  addPlayer(id, name, isBot = false) {
    if (this.phase !== 'LOBBY') return false;
    if (this.players.length >= 5) return false;

    this.players.push({
      id,
      name,
      isBot,
      hand: [],
      scorePile: [],
      scoutChips: 0,
      hasScoutAndShow: true,
      isReady: false,
      roundScore: 0,
      totalScore: 0
    });
    this.addLog(`玩家 [${name}] 加入了房间。`);
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx !== -1) {
      const p = this.players[idx];
      this.players.splice(idx, 1);
      this.addLog(`玩家 [${p.name}] 离开了房间。`);
      if (this.players.length < 2 && this.phase !== 'LOBBY') {
        this.phase = 'LOBBY';
        this.addLog('人数不足，游戏返回大厅。');
      }
      return true;
    }
    return false;
  }

  startNewGame() {
    if (this.players.length < 2 || this.players.length > 5) return false;
    this.maxRounds = this.players.length; // 默认轮数等于玩家人数
    this.round = 0;
    this.players.forEach(p => {
      p.totalScore = 0;
    });
    this.startingPlayerIndex = Math.floor(Math.random() * this.players.length);
    this.startRound();
    return true;
  }

  startRound() {
    this.round++;
    this.currentShow = null;
    this.consecutiveScouts = 0;
    this.lastRoundResult = null;

    // 确定本轮发牌与初始状态
    const { hands } = prepareDeckAndDeal(this.players.length);

    this.players.forEach((p, idx) => {
      p.hand = hands[idx];
      p.scorePile = [];
      p.scoutChips = 0;
      p.hasScoutAndShow = true;
      p.isReady = p.isBot; // 机器人默认准备好
      p.roundScore = 0;
    });

    this.activePlayerIndex = (this.startingPlayerIndex + this.round - 1) % this.players.length;
    this.phase = 'PREPARE';
    this.addLog(`=== 第 ${this.round} / ${this.maxRounds} 轮开始！请确认手牌方向并准备 ===`);
  }

  // 准备阶段：翻转整副手牌 180 度
  flipHand(playerId) {
    if (this.phase !== 'PREPARE') return { success: false, msg: '当前不是手牌准备阶段' };
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { success: false, msg: '玩家不存在' };
    if (player.isReady) return { success: false, msg: '已经准备，无法再调整' };

    player.hand.forEach(card => card.flip());
    return { success: true };
  }

  // 准备阶段：玩家点击就绪
  setReady(playerId) {
    if (this.phase !== 'PREPARE') return { success: false, msg: '当前不是准备阶段' };
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { success: false, msg: '玩家不存在' };

    player.isReady = true;
    this.addLog(`玩家 [${player.name}] 已就绪。`);

    // 检查是否全员就绪
    const allReady = this.players.every(p => p.isReady);
    if (allReady) {
      this.phase = 'PLAYING';
      const starter = this.players[this.activePlayerIndex];
      this.addLog(`全员准备完毕！由 [${starter.name}] 开始出牌。`);
    }

    return { success: true, allReady };
  }

  // 演出 (Show)
  playShow(playerId, selectedIndices) {
    if (this.phase !== 'PLAYING') return { success: false, msg: '游戏未在进行中' };
    const activePlayer = this.players[this.activePlayerIndex];
    if (activePlayer.id !== playerId) return { success: false, msg: '还没轮到你的回合' };

    if (!selectedIndices || selectedIndices.length === 0) {
      return { success: false, msg: '请选择要打出的牌' };
    }

    if (!isContiguous(selectedIndices)) {
      return { success: false, msg: '必须选择手牌中物理相邻的牌！' };
    }

    const minIdx = Math.min(...selectedIndices);
    const maxIdx = Math.max(...selectedIndices);
    const cardsToPlay = activePlayer.hand.slice(minIdx, maxIdx + 1);

    const combo = analyzeCombo(cardsToPlay);
    if (!combo) {
      return { success: false, msg: '所选牌既不是同号也不是顺子，无法演出！' };
    }

    if (!canBeat(combo, this.currentShow ? this.currentShow.combo : null)) {
      return { success: false, msg: '所选组合未能压过舞台上的表演！' };
    }

    // 演出成功！
    // 1. 如果舞台上有牌，收归演出者作为得分牌 (+1分/张)
    if (this.currentShow && this.currentShow.cards.length > 0) {
      activePlayer.scorePile.push(...this.currentShow.cards);
      this.addLog(`[${activePlayer.name}] 打出 ${combo.label}，吃下前任表演获得 ${this.currentShow.cards.length} 分！`);
    } else {
      this.addLog(`[${activePlayer.name}] 打出了 ${combo.label} 作为新的领头表演！`);
    }

    // 2. 从手牌中移除这几张牌
    activePlayer.hand.splice(minIdx, cardsToPlay.length);

    // 3. 更新桌面表演
    this.currentShow = {
      cards: cardsToPlay,
      combo: combo,
      playerId: activePlayer.id,
      playerName: activePlayer.name
    };

    // 4. 重置连续挖角/过牌计数
    this.consecutiveScouts = 0;

    // 5. 检查是否清空手牌 -> 触发轮次结束
    if (activePlayer.hand.length === 0) {
      this.endRound('EMPTY_HAND', activePlayer.id);
      return { success: true, roundEnded: true };
    }

    // 6. 顺延到下一个玩家
    this.nextTurn();
    return { success: true, roundEnded: false };
  }

  // 挖角 (Scout)
  playScout(playerId, side, flip = false, insertIndex = 0) {
    if (this.phase !== 'PLAYING') return { success: false, msg: '游戏未在进行中' };
    const activePlayer = this.players[this.activePlayerIndex];
    if (activePlayer.id !== playerId) return { success: false, msg: '还没轮到你的回合' };

    if (!this.currentShow || !this.currentShow.cards || this.currentShow.cards.length === 0) {
      return { success: false, msg: '舞台上没有可挖角的牌！' };
    }

    if (side !== 'left' && side !== 'right') {
      return { success: false, msg: '只能从舞台最左侧或最右侧挖角！' };
    }

    // 1. 取出卡牌
    const card = (side === 'left') 
      ? this.currentShow.cards.shift() 
      : this.currentShow.cards.pop();

    if (flip) {
      card.flip();
    }

    // 2. 插入到手牌指定位置
    const clampedIndex = Math.max(0, Math.min(insertIndex, activePlayer.hand.length));
    activePlayer.hand.splice(clampedIndex, 0, card);

    // 3. 舞台原主获得 1 枚挖角筹码
    const showOwner = this.players.find(p => p.id === this.currentShow.playerId);
    if (showOwner) {
      showOwner.scoutChips += 1;
      this.addLog(`[${activePlayer.name}] 从舞台${side === 'left' ? '左侧' : '右侧'}挖走了 [${card.top}]，[${showOwner.name}] 获得 1 枚挖角筹码！`);
    }

    // 4. 如果台上被挖空
    if (this.currentShow.cards.length === 0) {
      this.currentShow = null;
      this.addLog('舞台已被挖空，下家可自由开秀！');
    }

    // 5. 推进连续挖角计数
    this.consecutiveScouts++;

    // 6. 检查是否绕场一周无人出牌 (Loop)
    if (this.consecutiveScouts >= this.players.length - 1 && this.currentShow) {
      // 成功绕场一周回到表演者
      this.endRound('LOOP', this.currentShow.playerId);
      return { success: true, roundEnded: true };
    }

    // 7. 顺延到下一个玩家
    this.nextTurn();
    return { success: true, roundEnded: false };
  }

  // 挖角并演出 (Scout & Show)
  playScoutAndShow(playerId, scoutData, showIndices) {
    if (this.phase !== 'PLAYING') return { success: false, msg: '游戏未在进行中' };
    const activePlayer = this.players[this.activePlayerIndex];
    if (activePlayer.id !== playerId) return { success: false, msg: '还没轮到你的回合' };

    if (!activePlayer.hasScoutAndShow) {
      return { success: false, msg: '你本轮的“挖角并演出”机会已使用！' };
    }

    if (!this.currentShow || !this.currentShow.cards || this.currentShow.cards.length === 0) {
      return { success: false, msg: '舞台上没有可挖角的牌！' };
    }

    const { side, flip, insertIndex } = scoutData;
    if (side !== 'left' && side !== 'right') {
      return { success: false, msg: '只能从最左侧或最右侧挖角！' };
    }

    // 1. 模拟执行 Scout
    const scoutedCard = (side === 'left') 
      ? this.currentShow.cards.shift() 
      : this.currentShow.cards.pop();

    if (flip) scoutedCard.flip();
    const clampedIndex = Math.max(0, Math.min(insertIndex, activePlayer.hand.length));
    activePlayer.hand.splice(clampedIndex, 0, scoutedCard);

    const showOwner = this.players.find(p => p.id === this.currentShow.playerId);
    if (showOwner) {
      showOwner.scoutChips += 1;
    }

    // 2. 检验紧接着的 Show
    if (!showIndices || showIndices.length === 0 || !isContiguous(showIndices)) {
      // 回滚
      activePlayer.hand.splice(clampedIndex, 1);
      if (side === 'left') this.currentShow.cards.unshift(scoutedCard);
      else this.currentShow.cards.push(scoutedCard);
      if (showOwner) showOwner.scoutChips -= 1;
      return { success: false, msg: '出牌必须在手牌中相邻！' };
    }

    const minIdx = Math.min(...showIndices);
    const maxIdx = Math.max(...showIndices);
    const cardsToPlay = activePlayer.hand.slice(minIdx, maxIdx + 1);

    const combo = analyzeCombo(cardsToPlay);
    // 舞台上剩下的牌进行比对
    const previousShowToBeat = this.currentShow.cards.length > 0 ? analyzeCombo(this.currentShow.cards) : null;
    
    if (!combo || !canBeat(combo, previousShowToBeat)) {
      // 回滚
      activePlayer.hand.splice(clampedIndex, 1);
      if (side === 'left') this.currentShow.cards.unshift(scoutedCard);
      else this.currentShow.cards.push(scoutedCard);
      if (showOwner) showOwner.scoutChips -= 1;
      return { success: false, msg: '打出的牌无法压过舞台上剩余的牌！' };
    }

    // 正式生效 Scout & Show
    activePlayer.hasScoutAndShow = false;

    // 舞台上剩余牌收为得分牌
    if (this.currentShow.cards.length > 0) {
      activePlayer.scorePile.push(...this.currentShow.cards);
    }

    // 从手牌移除打出的牌
    activePlayer.hand.splice(minIdx, cardsToPlay.length);

    this.addLog(`⚡ [${activePlayer.name}] 触发【挖角并演出】！挖走 [${scoutedCard.top}] 并打出 ${combo.label}！`);

    // 设置新表演
    this.currentShow = {
      cards: cardsToPlay,
      combo: combo,
      playerId: activePlayer.id,
      playerName: activePlayer.name
    };
    this.consecutiveScouts = 0;

    // 检查手牌清空
    if (activePlayer.hand.length === 0) {
      this.endRound('EMPTY_HAND', activePlayer.id);
      return { success: true, roundEnded: true };
    }

    this.nextTurn();
    return { success: true, roundEnded: false };
  }

  nextTurn() {
    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
    const nextPlayer = this.players[this.activePlayerIndex];
    this.addLog(`轮到 [${nextPlayer.name}] 行动。`);
  }

  // 轮次结算
  endRound(triggerType, triggerPlayerId) {
    this.phase = 'ROUND_OVER';
    const triggerPlayer = this.players.find(p => p.id === triggerPlayerId);

    if (triggerType === 'EMPTY_HAND') {
      this.addLog(`🎉 [${triggerPlayer.name}] 率先清空了手牌！本轮结束进行结算。`);
    } else if (triggerType === 'LOOP') {
      this.addLog(`👑 [${triggerPlayer.name}] 的表演无人能敌，成功绕场一周！本轮结束进行结算。`);
    }

    // 计算得分
    const roundScores = this.players.map(p => {
      const showPoints = p.scorePile.length;
      const chipPoints = p.scoutChips;
      // 豁免规则：如果因绕场一周结束，成功绕场的表演者免扣手牌分
      const isExempt = (triggerType === 'LOOP' && p.id === triggerPlayerId);
      const handPenalty = isExempt ? 0 : p.hand.length;
      const netScore = showPoints + chipPoints - handPenalty;

      p.roundScore = netScore;
      p.totalScore += netScore;

      return {
        id: p.id,
        name: p.name,
        showPoints,
        chipPoints,
        handPenalty,
        isExempt,
        netScore,
        totalScore: p.totalScore
      };
    });

    this.lastRoundResult = {
      triggerType,
      triggerPlayerName: triggerPlayer ? triggerPlayer.name : '',
      round: this.round,
      maxRounds: this.maxRounds,
      scores: roundScores
    };

    if (this.round >= this.maxRounds) {
      this.phase = 'GAME_OVER';
      // 找出冠军
      const sorted = [...this.players].sort((a, b) => b.totalScore - a.totalScore);
      this.addLog(`🏆 游戏全部结束！冠军是 [${sorted[0].name}]，最终得分：${sorted[0].totalScore} 分！`);
    }
  }

  // 获取向指定客户端广播的视角（隐藏其他人的手牌细节，仅透露张数）
  getClientState(playerId) {
    const me = this.players.find(p => p.id === playerId);

    return {
      roomId: this.roomId,
      phase: this.phase,
      round: this.round,
      maxRounds: this.maxRounds,
      activePlayerIndex: this.activePlayerIndex,
      activePlayerId: this.players[this.activePlayerIndex] ? this.players[this.activePlayerIndex].id : null,
      currentShow: this.currentShow ? {
        cards: this.currentShow.cards.map(c => ({ id: c.id, top: c.top, bottom: c.bottom })),
        combo: this.currentShow.combo,
        playerId: this.currentShow.playerId,
        playerName: this.currentShow.playerName
      } : null,
      logs: this.actionLogs.slice(0, 15),
      lastRoundResult: this.lastRoundResult,
      // 玩家公开信息
      players: this.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        isHost: idx === 0,
        handCount: p.hand.length,
        scorePileCount: p.scorePile.length,
        scoutChips: p.scoutChips,
        hasScoutAndShow: p.hasScoutAndShow,
        isReady: p.isReady,
        roundScore: p.roundScore,
        totalScore: p.totalScore
      })),
      // 自己的私密手牌
      myHand: me ? me.hand.map(c => ({ id: c.id, top: c.top, bottom: c.bottom })) : [],
      myInfo: me ? {
        id: me.id,
        name: me.name,
        hasScoutAndShow: me.hasScoutAndShow,
        isReady: me.isReady,
        isHost: this.players.length > 0 && this.players[0].id === me.id
      } : null
    };
  }
}

module.exports = ScoutGame;

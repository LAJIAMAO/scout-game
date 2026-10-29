// app.js - SCOUT 网页版客户端主逻辑

const socket = io();

// 客户端本地状态
let myRoomId = null;
let isHost = false;
let myPlayerId = null;
let gameState = null;
let selectedIndices = new Set();
let scoutState = null; // null 或 { side: 'left'|'right', card: Card, flipped: boolean, isScoutAndShow: boolean }
let isScoutAndShowMode = false;

// DOM 元素引用
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');
const lobbyJoinSection = document.getElementById('lobby-join-section');
const lobbyRoomSection = document.getElementById('lobby-room-section');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const hostLobbyControls = document.getElementById('host-lobby-controls');
const guestWaitingHint = document.getElementById('guest-waiting-hint');

const headerRoomInfo = document.getElementById('header-room-info');
const displayRoomCode = document.getElementById('display-room-code');
const displayRoundInfo = document.getElementById('display-round-info');

const otherPlayersContainer = document.getElementById('other-players-container');
const stageCardsBox = document.getElementById('stage-cards-box');
const stageComboText = document.getElementById('stage-combo-text');
const stageScoutTriggers = document.getElementById('stage-scout-triggers');
const gameStatusBanner = document.getElementById('game-status-banner');

const myHandContainer = document.getElementById('my-hand-container');
const myScorePileCount = document.getElementById('my-score-pile-count');
const myScoutChipsCount = document.getElementById('my-scout-chips-count');
const myScoutShowStatus = document.getElementById('my-scout-show-status');

const prepareControls = document.getElementById('prepare-controls');
const playingControls = document.getElementById('playing-controls');
const scoutPlacementControls = document.getElementById('scout-placement-controls');
const scoutCardPreviewText = document.getElementById('scout-card-preview-text');

const btnActionShow = document.getElementById('btn-action-show');
const btnActionScoutShow = document.getElementById('btn-action-scout-show');
const btnClearSelection = document.getElementById('btn-clear-selection');
const btnFlipScoutCard = document.getElementById('btn-flip-scout-card');
const btnCancelScout = document.getElementById('btn-cancel-scout');

const roundModal = document.getElementById('round-modal');
const gameoverModal = document.getElementById('gameover-modal');
const rulesModal = document.getElementById('rules-modal');

// URL 参数解析：如果带有 ?room=ABCD 自动填入输入框
const urlParams = new URLSearchParams(window.location.search);
const queryRoom = urlParams.get('room');
if (queryRoom) {
  document.getElementById('input-room-code').value = queryRoom.toUpperCase();
}

// ================= 事件监听：大厅互动 =================
document.getElementById('btn-create-room').addEventListener('click', () => {
  const nickname = document.getElementById('input-nickname').value.trim();
  socket.emit('create_room', { playerName: nickname });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const nickname = document.getElementById('input-nickname').value.trim();
  const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!roomCode) {
    alert('请输入4位房间号！');
    return;
  }
  socket.emit('join_room', { roomId: roomCode, playerName: nickname });
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
  if (!myRoomId) return;
  const shareUrl = `${window.location.origin}?room=${myRoomId}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    alert(`邀请链接已复制到剪贴板！发送给好友即可加入：\n${shareUrl}`);
  }).catch(() => {
    prompt('复制此链接发送给好友：', shareUrl);
  });
});

document.getElementById('btn-add-bot').addEventListener('click', () => {
  socket.emit('add_bot');
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('start_game');
});

// ================= 规则与音效弹窗 =================
document.getElementById('btn-open-rules').addEventListener('click', () => {
  rulesModal.style.display = 'flex';
});

document.getElementById('btn-close-rules').addEventListener('click', () => {
  rulesModal.style.display = 'none';
});

document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
  const enabled = window.soundFx.toggle();
  e.target.textContent = enabled ? '🔊 音效' : '🔇 静音';
});

// ================= 准备阶段控制 =================
document.getElementById('btn-flip-hand').addEventListener('click', () => {
  window.soundFx.playCardClick();
  socket.emit('flip_hand');
});

document.getElementById('btn-ready-hand').addEventListener('click', () => {
  window.soundFx.playCardClick();
  socket.emit('ready');
});

// ================= 出牌与挖角控制 =================
btnActionShow.addEventListener('click', () => {
  if (selectedIndices.size === 0) return;
  window.soundFx.playShow();
  socket.emit('action_show', {
    selectedIndices: Array.from(selectedIndices)
  });
  selectedIndices.clear();
});

btnClearSelection.addEventListener('click', () => {
  selectedIndices.clear();
  updateSelectionAndShowButton();
  renderHand();
});

// 开启挖角并演出模式
btnActionScoutShow.addEventListener('click', () => {
  if (!gameState || !gameState.currentShow) return;
  isScoutAndShowMode = true;
  alert('【挖角并演出】：请先点击舞台左右两侧的卡牌选择挖角！');
});

// 舞台左右挖角按钮
document.getElementById('btn-scout-left').addEventListener('click', () => {
  startScoutAction('left');
});

document.getElementById('btn-scout-right').addEventListener('click', () => {
  startScoutAction('right');
});

function startScoutAction(side) {
  if (!gameState || !gameState.currentShow) return;
  const cards = gameState.currentShow.cards;
  const targetCard = (side === 'left') ? cards[0] : cards[cards.length - 1];
  if (!targetCard) return;

  scoutState = {
    side: side,
    card: { ...targetCard },
    flipped: false,
    isScoutAndShow: isScoutAndShowMode
  };

  window.soundFx.playScout();
  selectedIndices.clear();
  updateScoutPlacementUI();
  renderHand();
}

btnFlipScoutCard.addEventListener('click', () => {
  if (!scoutState) return;
  scoutState.flipped = !scoutState.flipped;
  window.soundFx.playCardClick();
  updateScoutPlacementUI();
});

btnCancelScout.addEventListener('click', () => {
  scoutState = null;
  isScoutAndShowMode = false;
  updateScoutPlacementUI();
  renderHand();
});

function updateScoutPlacementUI() {
  if (scoutState) {
    playingControls.style.display = 'none';
    scoutPlacementControls.style.display = 'flex';
    const activeNum = scoutState.flipped ? scoutState.card.bottom : scoutState.card.top;
    const revNum = scoutState.flipped ? scoutState.card.top : scoutState.card.bottom;
    scoutCardPreviewText.textContent = `待插入卡牌: [${activeNum}] (反面: ${revNum})`;
    gameStatusBanner.textContent = '请在下方手牌中点击绿色的 [+] 插槽选择插入位置';
    gameStatusBanner.classList.add('is-my-turn');
  } else {
    scoutPlacementControls.style.display = 'none';
    if (gameState && gameState.phase === 'PLAYING') {
      playingControls.style.display = 'flex';
    }
  }
}

// 结算弹窗动作
document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('next_round');
  roundModal.style.display = 'none';
});

document.getElementById('btn-restart-game').addEventListener('click', () => {
  socket.emit('restart_game');
  gameoverModal.style.display = 'none';
});

// ================= Socket.IO 事件监听 =================
socket.on('room_joined', (data) => {
  myRoomId = data.roomId;
  isHost = data.isHost;
  myPlayerId = socket.id;

  displayRoomCode.textContent = `房间号: ${myRoomId}`;
  headerRoomInfo.style.display = 'flex';
  lobbyJoinSection.style.display = 'none';
  lobbyRoomSection.style.display = 'block';

  // 替换浏览器 URL 参数方便随时复制
  window.history.replaceState(null, '', `?room=${myRoomId}`);
});

socket.on('error_message', (msg) => {
  alert(msg);
});

socket.on('game_state_update', (state) => {
  gameState = state;
  renderAll();
});

// ================= 核心渲染函数 =================
function renderAll() {
  if (!gameState) return;

  const phase = gameState.phase;

  // 1. 大厅与主游戏视图切换
  if (phase === 'LOBBY') {
    lobbyView.style.display = 'flex';
    gameView.style.display = 'none';
    roundModal.style.display = 'none';
    gameoverModal.style.display = 'none';
    renderLobby();
    return;
  }

  lobbyView.style.display = 'none';
  gameView.style.display = 'flex';

  // 2. 顶部轮次信息
  displayRoundInfo.textContent = `第 ${gameState.round} / ${gameState.maxRounds} 轮`;

  // 3. 渲染环绕其他玩家
  renderOtherPlayers();

  // 4. 渲染中央舞台
  renderStage();

  // 5. 渲染底部手牌与操作按钮
  renderHand();
  renderActionControls();

  // 6. 模态弹窗控制
  if (phase === 'ROUND_OVER') {
    renderRoundOverModal();
  } else {
    roundModal.style.display = 'none';
  }

  if (phase === 'GAME_OVER') {
    renderGameOverModal();
  } else {
    gameoverModal.style.display = 'none';
  }
}

function renderLobby() {
  lobbyPlayerList.innerHTML = '';
  const isMeHost = gameState.players.length > 0 && gameState.players[0].id === socket.id;

  gameState.players.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = `player-item ${p.id === socket.id ? 'is-me' : ''}`;

    let badgeHtml = '';
    if (idx === 0) badgeHtml += '<span class="badge badge-host">房主</span> ';
    if (p.isBot) badgeHtml += '<span class="badge badge-bot">电脑</span>';

    item.innerHTML = `
      <div class="name">
        <span>👤</span>
        <span>${p.name} ${badgeHtml}</span>
      </div>
      <div>
        ${isMeHost && p.isBot ? `<button class="btn-icon" style="color:var(--accent-red);padding:2px 8px;" onclick="removeBot('${p.id}')">移除</button>` : ''}
      </div>
    `;
    lobbyPlayerList.appendChild(item);
  });

  if (isMeHost) {
    hostLobbyControls.style.display = 'flex';
    guestWaitingHint.style.display = 'none';
    document.getElementById('btn-add-bot').disabled = gameState.players.length >= 5;
    document.getElementById('btn-start-game').disabled = gameState.players.length < 2;
  } else {
    hostLobbyControls.style.display = 'none';
    guestWaitingHint.style.display = 'block';
  }
}

window.removeBot = function(botId) {
  socket.emit('remove_bot', { botId });
};

function renderOtherPlayers() {
  otherPlayersContainer.innerHTML = '';
  const myId = socket.id;

  gameState.players.forEach(p => {
    if (p.id === myId) return; // 只渲染其他人

    const isTurn = (gameState.activePlayerId === p.id && gameState.phase === 'PLAYING');
    const card = document.createElement('div');
    card.className = `other-player-card ${isTurn ? 'active-turn' : ''}`;

    let statusTag = '';
    if (gameState.phase === 'PREPARE') {
      statusTag = p.isReady ? '✅ 已就绪' : '⏳ 调整中';
    } else if (isTurn) {
      statusTag = '🎲 思考中';
    }

    card.innerHTML = `
      <div class="p-name">
        <span>${p.name}</span>
        <span style="font-size:0.75rem; color:var(--accent-yellow);">${statusTag}</span>
      </div>
      <div class="p-stats">
        <span>手牌: <strong>${p.handCount}</strong></span>
        <span>得分: <strong>${p.scorePileCount + p.scoutChips}</strong></span>
        <span>总分: <strong>${p.totalScore}</strong></span>
      </div>
    `;
    otherPlayersContainer.appendChild(card);
  });
}

function renderStage() {
  stageCardsBox.innerHTML = '';
  const currentShow = gameState.currentShow;
  const isMyTurn = (gameState.activePlayerId === socket.id && gameState.phase === 'PLAYING');

  if (!currentShow || !currentShow.cards || currentShow.cards.length === 0) {
    stageComboText.textContent = '舞台空置，等待玩家起秀';
    stageCardsBox.innerHTML = '<div class="stage-empty-placeholder">当前舞台没有任何表演</div>';
    stageScoutTriggers.style.display = 'none';
  } else {
    stageComboText.textContent = `${currentShow.playerName} 打出: ${currentShow.combo.label}`;

    currentShow.cards.forEach(c => {
      const cardEl = createCardElement(c, false);
      stageCardsBox.appendChild(cardEl);
    });

    // 只有在自己的出牌回合，且舞台有牌，且未处于插牌状态时，显示舞台挖角按钮
    if (isMyTurn && !scoutState) {
      stageScoutTriggers.style.display = 'flex';
    } else {
      stageScoutTriggers.style.display = 'none';
    }
  }

  // 状态横幅提示
  if (gameState.phase === 'PREPARE') {
    gameStatusBanner.textContent = '手牌准备阶段：请选择是否 180° 翻转手牌，随后点击【准备就绪】';
    gameStatusBanner.classList.remove('is-my-turn');
  } else if (gameState.phase === 'PLAYING') {
    if (isMyTurn) {
      gameStatusBanner.textContent = '🎯 轮到你了！请选择相邻卡牌演出，或点击舞台挖角';
      gameStatusBanner.classList.add('is-my-turn');
    } else {
      const activeP = gameState.players.find(p => p.id === gameState.activePlayerId);
      gameStatusBanner.textContent = `等待 [${activeP ? activeP.name : '其他玩家'}] 行动中...`;
      gameStatusBanner.classList.remove('is-my-turn');
    }
  }
}

function renderHand() {
  myHandContainer.innerHTML = '';
  const hand = gameState.myHand || [];
  const isMyTurn = (gameState.activePlayerId === socket.id && gameState.phase === 'PLAYING');

  // 更新个人属性概览
  const me = gameState.players.find(p => p.id === socket.id);
  if (me) {
    myScorePileCount.textContent = me.scorePileCount;
    myScoutChipsCount.textContent = me.scoutChips;
    myScoutShowStatus.textContent = me.hasScoutAndShow ? '可用' : '已消耗';
    myScoutShowStatus.style.color = me.hasScoutAndShow ? 'var(--accent-teal)' : 'var(--text-muted)';
  }

  // 如果处于挖角插槽模式，在手牌首位、每个卡牌缝隙、末尾渲染 [+] 插入按钮
  if (scoutState) {
    for (let i = 0; i <= hand.length; i++) {
      // 插入插槽
      const slot = document.createElement('div');
      slot.className = 'insert-slot';
      slot.innerHTML = '+';
      slot.title = `插入到第 ${i} 位`;
      slot.addEventListener('click', () => handleSlotChosen(i));
      myHandContainer.appendChild(slot);

      if (i < hand.length) {
        const cardEl = createCardElement(hand[i], false);
        cardEl.style.cursor = 'default';
        myHandContainer.appendChild(cardEl);
      }
    }
    return;
  }

  // 正常手牌渲染
  hand.forEach((c, idx) => {
    const cardEl = createCardElement(c, false);
    if (selectedIndices.has(idx)) {
      cardEl.classList.add('selected');
    }

    cardEl.addEventListener('click', () => {
      if (gameState.phase !== 'PLAYING' || !isMyTurn) return;
      window.soundFx.playCardClick();

      if (selectedIndices.has(idx)) {
        selectedIndices.delete(idx);
      } else {
        selectedIndices.add(idx);
      }
      updateSelectionAndShowButton();
      renderHand();
    });

    myHandContainer.appendChild(cardEl);
  });
}

// 点击插槽确定插入位置
function handleSlotChosen(insertIndex) {
  if (!scoutState) return;

  if (scoutState.isScoutAndShow) {
    // 挖角并演出：需要第二步选择出牌
    alert('已选定插入位置！请立刻在手牌中选择相邻组合完成演出！');
    // 本地预先模拟插入，供玩家选牌
    const clonedHand = [...gameState.myHand];
    const previewCard = { ...scoutState.card };
    if (scoutState.flipped) {
      const temp = previewCard.top;
      previewCard.top = previewCard.bottom;
      previewCard.bottom = temp;
    }
    clonedHand.splice(insertIndex, 0, previewCard);
    gameState.myHand = clonedHand;

    const savedScoutData = {
      side: scoutState.side,
      flip: scoutState.flipped,
      insertIndex: insertIndex
    };
    scoutState = null;
    updateScoutPlacementUI();

    // 变换出牌按钮为提交
    btnActionShow.disabled = false;
    btnActionShow.textContent = '🚀 完成【挖角并演出】';
    btnActionShow.onclick = () => {
      if (selectedIndices.size === 0) {
        alert('请选择要打出的组合！');
        return;
      }
      window.soundFx.playScoutAndShow();
      socket.emit('action_scout_and_show', {
        scoutData: savedScoutData,
        showIndices: Array.from(selectedIndices)
      });
      selectedIndices.clear();
      btnActionShow.onclick = null;
    };
    renderHand();
    return;
  }

  // 普通挖角：直接发送指令
  window.soundFx.playScout();
  socket.emit('action_scout', {
    side: scoutState.side,
    flip: scoutState.flipped,
    insertIndex: insertIndex
  });

  scoutState = null;
  updateScoutPlacementUI();
}

function renderActionControls() {
  const phase = gameState.phase;
  const isMyTurn = (gameState.activePlayerId === socket.id && phase === 'PLAYING');
  const me = gameState.players.find(p => p.id === socket.id);

  if (phase === 'PREPARE') {
    prepareControls.style.display = 'flex';
    playingControls.style.display = 'none';
    scoutPlacementControls.style.display = 'none';

    document.getElementById('btn-flip-hand').disabled = me ? me.isReady : false;
    document.getElementById('btn-ready-hand').disabled = me ? me.isReady : false;
    document.getElementById('btn-ready-hand').textContent = (me && me.isReady) ? '✅ 已就绪 (等待他人)' : '✅ 准备就绪';
    return;
  }

  prepareControls.style.display = 'none';

  if (phase === 'PLAYING') {
    if (!scoutState) {
      playingControls.style.display = 'flex';
      btnActionScoutShow.disabled = !isMyTurn || (me && !me.hasScoutAndShow) || !gameState.currentShow;
      btnClearSelection.style.display = selectedIndices.size > 0 ? 'inline-flex' : 'none';
      updateSelectionAndShowButton();
    }
  } else {
    playingControls.style.display = 'none';
  }
}

// 动态检验手牌选中组合与演出按钮状态
function updateSelectionAndShowButton() {
  const isMyTurn = (gameState.activePlayerId === socket.id && gameState.phase === 'PLAYING');
  if (!isMyTurn || selectedIndices.size === 0) {
    btnActionShow.disabled = true;
    btnActionShow.textContent = '🎭 演出 (Show)';
    return;
  }

  const indices = Array.from(selectedIndices).sort((a, b) => a - b);

  // 1. 检查物理相邻性
  let isContiguous = true;
  for (let i = 0; i < indices.length - 1; i++) {
    if (indices[i + 1] !== indices[i] + 1) {
      isContiguous = false;
      break;
    }
  }

  if (!isContiguous) {
    btnActionShow.disabled = true;
    btnActionShow.textContent = '❌ 所选牌必须在手中相邻！';
    return;
  }

  // 2. 检验牌型与压制力
  const selectedCards = indices.map(idx => gameState.myHand[idx]);
  const combo = analyzeComboClient(selectedCards);

  if (!combo) {
    btnActionShow.disabled = true;
    btnActionShow.textContent = '❌ 非同号或连续顺子';
    return;
  }

  const currentShow = gameState.currentShow;
  const canBeat = canBeatClient(combo, currentShow ? currentShow.combo : null);

  if (!canBeat) {
    btnActionShow.disabled = true;
    btnActionShow.textContent = `❌ 无法压制当前表演 (${combo.label})`;
    return;
  }

  btnActionShow.disabled = false;
  btnActionShow.textContent = `🎭 打出: ${combo.label} (可压制)`;
}

// 客户端牌型分析
function analyzeComboClient(cards) {
  if (!cards || cards.length === 0) return null;
  const count = cards.length;
  const numbers = cards.map(c => c.top);

  if (count === 1) {
    return { type: 'set', count: 1, value: numbers[0], label: `单张 [${numbers[0]}]` };
  }

  const isSet = numbers.every(n => n === numbers[0]);
  if (isSet) {
    return { type: 'set', count: count, value: numbers[0], label: `${count}张同号 [${numbers[0]}]` };
  }

  let isAscending = true;
  let isDescending = true;
  for (let i = 0; i < count - 1; i++) {
    if (numbers[i + 1] !== numbers[i] + 1) isAscending = false;
    if (numbers[i + 1] !== numbers[i] - 1) isDescending = false;
  }

  if (isAscending || isDescending) {
    const maxVal = Math.max(...numbers);
    const minVal = Math.min(...numbers);
    return { type: 'run', count: count, value: maxVal, label: `${count}张顺子 [${minVal}-${maxVal}]` };
  }

  return null;
}

function canBeatClient(newCombo, currentShowCombo) {
  if (!newCombo) return false;
  if (!currentShowCombo) return true;

  if (newCombo.count > currentShowCombo.count) return true;
  if (newCombo.count < currentShowCombo.count) return false;

  if (newCombo.type === 'set' && currentShowCombo.type === 'run') return true;
  if (newCombo.type === 'run' && currentShowCombo.type === 'set') return false;

  return newCombo.value > currentShowCombo.value;
}

// 生成卡牌 DOM 元素
function createCardElement(card, isSmall = false) {
  const el = document.createElement('div');
  el.className = `scout-card ${isSmall ? 'small' : ''}`;

  el.innerHTML = `
    <div class="num-top num-val-${card.top}">${card.top}</div>
    <div class="card-center-icon">★</div>
    <div class="num-bottom num-val-${card.bottom}">${card.bottom}</div>
  `;
  return el;
}

// 单轮结算展示
function renderRoundOverModal() {
  const result = gameState.lastRoundResult;
  if (!result) return;

  roundModal.style.display = 'flex';
  const descEl = document.getElementById('round-result-desc');
  if (result.triggerType === 'EMPTY_HAND') {
    descEl.textContent = `🎉 玩家 [${result.triggerPlayerName}] 率先清空了所有手牌！`;
  } else {
    descEl.textContent = `👑 [${result.triggerPlayerName}] 的演出无人能敌，绕场一周获胜（免扣手牌分）！`;
  }

  const tbody = document.getElementById('round-score-tbody');
  tbody.innerHTML = '';

  result.scores.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700;">${s.name}</td>
      <td style="color:var(--accent-teal);">+${s.showPoints}</td>
      <td style="color:var(--accent-yellow);">+${s.chipPoints}</td>
      <td style="color:var(--accent-red);">${s.isExempt ? '0 (豁免)' : `-${s.handPenalty}`}</td>
      <td style="font-weight:700; color:${s.netScore >= 0 ? 'var(--accent-teal)' : 'var(--accent-red)'};">${s.netScore > 0 ? '+' : ''}${s.netScore}</td>
      <td style="font-weight:800; font-size:1.05rem;">${s.totalScore}</td>
    `;
    tbody.appendChild(tr);
  });

  const isMeHost = gameState.players.length > 0 && gameState.players[0].id === socket.id;
  const btnNext = document.getElementById('btn-next-round');
  const waitHint = document.getElementById('guest-next-round-wait');

  if (isMeHost) {
    btnNext.style.display = 'inline-block';
    waitHint.style.display = 'none';
  } else {
    btnNext.style.display = 'none';
    waitHint.style.display = 'inline-block';
  }
}

// 终局结算展示
function renderGameOverModal() {
  gameoverModal.style.display = 'flex';
  window.soundFx.playVictory();

  const tbody = document.getElementById('gameover-score-tbody');
  tbody.innerHTML = '';

  const sorted = [...gameState.players].sort((a, b) => b.totalScore - a.totalScore);

  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    let rankText = `#${idx + 1}`;
    if (idx === 0) rankText = '🥇 冠军';
    else if (idx === 1) rankText = '🥈 亚军';
    else if (idx === 2) rankText = '🥉 季军';

    tr.innerHTML = `
      <td style="font-weight:800;">${rankText}</td>
      <td style="font-weight:700; font-size:1rem;">${p.name}</td>
      <td class="${idx === 0 ? 'winner' : ''}" style="font-weight:900; font-size:1.2rem;">${p.totalScore} 分</td>
    `;
    tbody.appendChild(tr);
  });

  const isMeHost = gameState.players.length > 0 && gameState.players[0].id === socket.id;
  document.getElementById('btn-restart-game').style.display = isMeHost ? 'inline-block' : 'none';
}

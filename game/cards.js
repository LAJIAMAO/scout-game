// cards.js - SCOUT 牌库与卡牌定义
// 45张双向数字卡牌：(1,2), (1,3) ... (9,10)

class Card {
  constructor(id, top, bottom) {
    this.id = id;         // 唯一编号 1~45
    this.top = top;       // 当前朝上显示的数字 (1~10)
    this.bottom = bottom; // 当前朝下颠倒的数字 (1~10)
  }

  // 翻转卡牌 180 度
  flip() {
    const temp = this.top;
    this.top = this.bottom;
    this.bottom = temp;
  }

  clone() {
    return new Card(this.id, this.top, this.bottom);
  }
}

// 生成全部45张双向卡牌
function generateFullDeck() {
  const deck = [];
  let id = 1;
  for (let i = 1; i <= 9; i++) {
    for (let j = i + 1; j <= 10; j++) {
      // 随机决定发牌时的正反面朝向
      const flipRandom = Math.random() < 0.5;
      const top = flipRandom ? j : i;
      const bottom = flipRandom ? i : j;
      deck.push(new Card(id++, top, bottom));
    }
  }
  return deck;
}

// 洗牌算法（Fisher-Yates），同时随机打乱顺序与初始朝向
function shuffleDeck(deck) {
  const shuffled = deck.map(c => c.clone());
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    if (Math.random() < 0.5) {
      shuffled[i].flip();
    }
  }
  return shuffled;
}

// 根据玩家人数准备牌库和发牌张数
// 2人: 剔除 (9,10)，每人发 11 张
// 3人: 剔除全部含 10 的牌 (9张，剩36张)，每人发 12 张
// 4人: 剔除 (9,10)，每人发 11 张 (剩 44 张)
// 5人: 全部 45 张，每人发 9 张
function prepareDeckAndDeal(playerCount) {
  let deck = generateFullDeck();

  if (playerCount === 3) {
    // 移除所有包含 10 的牌
    deck = deck.filter(c => c.top !== 10 && c.bottom !== 10);
  } else if (playerCount === 2 || playerCount === 4) {
    // 移除 (9, 10) 牌
    deck = deck.filter(c => !( (c.top === 9 && c.bottom === 10) || (c.top === 10 && c.bottom === 9) ));
  }

  const shuffled = shuffleDeck(deck);

  let cardsPerPlayer = 11;
  if (playerCount === 2) cardsPerPlayer = 11;
  else if (playerCount === 3) cardsPerPlayer = 12;
  else if (playerCount === 4) cardsPerPlayer = 11;
  else if (playerCount === 5) cardsPerPlayer = 9;

  const hands = [];
  for (let p = 0; p < playerCount; p++) {
    const startIdx = p * cardsPerPlayer;
    hands.push(shuffled.slice(startIdx, startIdx + cardsPerPlayer));
  }

  return { hands, cardsPerPlayer };
}

module.exports = {
  Card,
  generateFullDeck,
  shuffleDeck,
  prepareDeckAndDeal
};

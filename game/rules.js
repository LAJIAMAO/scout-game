// rules.js - SCOUT 牌型检验与大小裁决逻辑

/**
 * 检验给定的卡牌序列是否为有效牌型
 * @param {Array<Card>} cards 
 * @returns {Object|null} { type: 'set'|'run', count: number, value: number, numbers: number[] }
 */
function analyzeCombo(cards) {
  if (!cards || cards.length === 0) return null;

  const count = cards.length;
  const numbers = cards.map(c => c.top);

  // 单张牌：既算作单张 Set，最大点数就是该卡点数
  if (count === 1) {
    return {
      type: 'set',
      count: 1,
      value: numbers[0],
      numbers: numbers,
      label: `单张 [${numbers[0]}]`
    };
  }

  // 1. 检查是否为同号组合 (Set)
  const isSet = numbers.every(n => n === numbers[0]);
  if (isSet) {
    return {
      type: 'set',
      count: count,
      value: numbers[0],
      numbers: numbers,
      label: `${count}张同号 [${numbers[0]}]`
    };
  }

  // 2. 检查是否为递增顺子 (Ascending Run, e.g., 3, 4, 5)
  let isAscending = true;
  for (let i = 0; i < count - 1; i++) {
    if (numbers[i + 1] !== numbers[i] + 1) {
      isAscending = false;
      break;
    }
  }

  // 3. 检查是否为递减顺子 (Descending Run, e.g., 5, 4, 3)
  let isDescending = true;
  for (let i = 0; i < count - 1; i++) {
    if (numbers[i + 1] !== numbers[i] - 1) {
      isDescending = false;
      break;
    }
  }

  if (isAscending || isDescending) {
    const maxVal = Math.max(...numbers);
    const minVal = Math.min(...numbers);
    return {
      type: 'run',
      count: count,
      value: maxVal,
      numbers: numbers,
      label: `${count}张顺子 [${minVal}-${maxVal}]`
    };
  }

  return null; // 不是有效牌型
}

/**
 * 判断 newCombo 是否能压过 currentShow
 * @param {Object} newCombo 
 * @param {Object|null} currentShow 
 * @returns {boolean}
 */
function canBeat(newCombo, currentShow) {
  if (!newCombo) return false;
  if (!currentShow) return true; // 场上无牌，任何合法组合都可以出

  // 1. 张数多一定压过张数少
  if (newCombo.count > currentShow.count) return true;
  if (newCombo.count < currentShow.count) return false;

  // 2. 张数相同时：同号 (Set) 大于 顺子 (Run)
  if (newCombo.type === 'set' && currentShow.type === 'run') return true;
  if (newCombo.type === 'run' && currentShow.type === 'set') return false;

  // 3. 张数相同且类型相同时：比较代表点数 (严格大于)
  return newCombo.value > currentShow.value;
}

/**
 * 检验手牌中选中的牌在物理上是否连续相邻
 * @param {Array<number>} selectedIndices 例如 [2, 3, 4]
 * @returns {boolean}
 */
function isContiguous(selectedIndices) {
  if (!selectedIndices || selectedIndices.length === 0) return false;
  const sorted = [...selectedIndices].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] !== sorted[i] + 1) return false;
  }
  return true;
}

/**
 * 寻找玩家手牌中所有合法的连续出牌切片
 * @param {Array<Card>} hand 
 * @param {Object|null} currentShow 
 * @returns {Array<Object>} [{ startIndex, endIndex, cards, combo }]
 */
function findAllPlayableCombos(hand, currentShow) {
  const result = [];
  const n = hand.length;

  for (let start = 0; start < n; start++) {
    for (let end = start; end < n; end++) {
      const slice = hand.slice(start, end + 1);
      const combo = analyzeCombo(slice);
      if (combo && canBeat(combo, currentShow)) {
        result.push({
          startIndex: start,
          endIndex: end,
          cards: slice,
          combo: combo
        });
      }
    }
  }

  return result;
}

/**
 * 评估一副手牌的“连结质量”得分（用于开局决定是否180度翻面以及AI决策）
 * 连续的对子和顺子越多，估分越高
 * @param {Array<Card>} hand 
 * @returns {number}
 */
function evaluateHandCohesion(hand) {
  let score = 0;
  const n = hand.length;
  if (n <= 1) return 0;

  // 扫描相邻卡牌的关系
  for (let i = 0; i < n - 1; i++) {
    const diff = Math.abs(hand[i].top - hand[i + 1].top);
    if (diff === 0) {
      score += 4; // 相邻对子加重分
    } else if (diff === 1) {
      score += 3; // 相邻顺子加分
    } else if (diff === 2) {
      score += 1; // 夹张潜力
    }
  }

  // 扫描长度 >= 3 的成型组合
  for (let start = 0; start < n; start++) {
    for (let end = start + 2; end < n; end++) {
      const slice = hand.slice(start, end + 1);
      const combo = analyzeCombo(slice);
      if (combo) {
        score += (combo.count * (combo.type === 'set' ? 3 : 2));
      }
    }
  }

  return score;
}

module.exports = {
  analyzeCombo,
  canBeat,
  isContiguous,
  findAllPlayableCombos,
  evaluateHandCohesion
};

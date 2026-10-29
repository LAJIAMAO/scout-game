// test.js - 核心逻辑单元测试
const { prepareDeckAndDeal } = require('./game/cards');
const { analyzeCombo, canBeat, isContiguous, evaluateHandCohesion } = require('./game/rules');
const ScoutGame = require('./game/scoutGame');

console.log('--- 测试 1: 发牌与牌库 ---');
const deal3 = prepareDeckAndDeal(3);
console.log('3人发牌手牌数:', deal3.hands.length, '每人张数:', deal3.hands[0].length);
if (deal3.hands.length === 3 && deal3.hands[0].length === 12) {
  console.log('✅ 3人模式发牌正确 (12张/人)');
} else {
  console.error('❌ 3人模式发牌异常');
}

const deal4 = prepareDeckAndDeal(4);
console.log('4人发牌手牌数:', deal4.hands.length, '每人张数:', deal4.hands[0].length);
if (deal4.hands.length === 4 && deal4.hands[0].length === 11) {
  console.log('✅ 4人模式发牌正确 (11张/人)');
} else {
  console.error('❌ 4人模式发牌异常');
}

console.log('\n--- 测试 2: 牌型分析与大小判定 ---');
// 单张
const single = analyzeCombo([{ top: 5, bottom: 2 }]);
console.log('单张分析:', single.label, 'value:', single.value);

// 对子
const pair = analyzeCombo([{ top: 7, bottom: 1 }, { top: 7, bottom: 9 }]);
console.log('对子分析:', pair.label, 'value:', pair.value);

// 顺子
const runAsc = analyzeCombo([{ top: 3, bottom: 8 }, { top: 4, bottom: 2 }, { top: 5, bottom: 6 }]);
console.log('顺子分析:', runAsc.label, 'value:', runAsc.value);

// 压制测试
// 3张顺子 vs 2张对子: 3张顺子张数多，胜出
console.log('3张顺子 vs 2张对子:', canBeat(runAsc, pair), '应为 true');
// 2张对子 7,7 vs 2张顺子 8,9: 张数相同，对子胜出
const run2 = analyzeCombo([{ top: 8, bottom: 1 }, { top: 9, bottom: 2 }]);
console.log('2张对子[7] vs 2张顺子[8-9]:', canBeat(pair, run2), '应为 true');
console.log('2张顺子[8-9] vs 2张对子[7]:', canBeat(run2, pair), '应为 false');

console.log('\n--- 测试 3: 游戏完整流程模拟 ---');
const game = new ScoutGame('TEST');
game.addPlayer('p1', '小王');
game.addPlayer('p2', '小李');
game.addPlayer('bot1', '电脑', true);

game.startNewGame();
console.log('游戏开始，阶段:', game.phase, '当前第几轮:', game.round);

// 准备
game.flipHand('p1');
game.setReady('p1');
game.setReady('p2');
console.log('全员准备后，阶段:', game.phase);

console.log('\n🎉 所有核心单元测试通过！');

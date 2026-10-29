// ai.js - 智能电脑玩家决策引擎

const { analyzeCombo, canBeat, findAllPlayableCombos, evaluateHandCohesion } = require('./rules');

class ScoutAI {
  /**
   * 准备阶段决策：评估是否需要翻转整副手牌
   */
  static decidePrepare(game, botPlayer) {
    const currentScore = evaluateHandCohesion(botPlayer.hand);

    // 虚拟翻转计算分数
    botPlayer.hand.forEach(c => c.flip());
    const flippedScore = evaluateHandCohesion(botPlayer.hand);

    // 如果原来朝向更好，翻转回去
    if (currentScore >= flippedScore) {
      botPlayer.hand.forEach(c => c.flip());
    }

    game.setReady(botPlayer.id);
  }

  /**
   * 出牌阶段决策：决定执行 Show、Scout 还是 Scout & Show
   */
  static decideTurn(game, botPlayer) {
    const hand = botPlayer.hand;
    const currentShow = game.currentShow;
    const playableCombos = findAllPlayableCombos(hand, currentShow ? currentShow.combo : null);

    // 优先检查：如果手牌能一把出完清空，直接出完赢得胜利！
    const winningCombo = playableCombos.find(c => c.cards.length === hand.length);
    if (winningCombo) {
      const indices = [];
      for (let i = winningCombo.startIndex; i <= winningCombo.endIndex; i++) {
        indices.push(i);
      }
      return game.playShow(botPlayer.id, indices);
    }

    // 寻找最佳 Scout 插入策略
    let bestScoutMove = null;
    let bestScoutGain = -999;

    if (currentShow && currentShow.cards && currentShow.cards.length > 0) {
      const sides = ['left', 'right'];
      const baseCohesion = evaluateHandCohesion(hand);

      for (const side of sides) {
        const sourceCard = (side === 'left') ? currentShow.cards[0] : currentShow.cards[currentShow.cards.length - 1];
        if (!sourceCard) continue;

        for (const flip of [false, true]) {
          const testCard = sourceCard.clone();
          if (flip) testCard.flip();

          // 遍历手牌所有可能插入的缝隙
          for (let i = 0; i <= hand.length; i++) {
            const tempHand = [...hand];
            tempHand.splice(i, 0, testCard);
            const cohesion = evaluateHandCohesion(tempHand);
            const gain = cohesion - baseCohesion;

            if (gain > bestScoutGain) {
              bestScoutGain = gain;
              bestScoutMove = { side, flip, insertIndex: i, resultingHand: tempHand };
            }
          }
        }
      }
    }

    // 策略权衡：
    // 如果手里有较强且张数 >= 2 的成型牌可以压过桌面：
    // 排序找出打出后留下牌型最健康的组合
    if (playableCombos.length > 0) {
      // 如果没有可挖的牌（桌面为空），直接出最长或最强的牌
      if (!currentShow || currentShow.cards.length === 0) {
        playableCombos.sort((a, b) => b.cards.length - a.cards.length || b.combo.value - a.combo.value);
        const best = playableCombos[0];
        const indices = [];
        for (let i = best.startIndex; i <= best.endIndex; i++) indices.push(i);
        return game.playShow(botPlayer.id, indices);
      }

      // 如果有可挖牌，但是挖角能带来很大的收益（比如把手牌粘合成更长顺子/大对子），优先挖角
      if (bestScoutMove && bestScoutGain >= 6 && playableCombos.every(c => c.cards.length <= 2)) {
        return game.playScout(botPlayer.id, bestScoutMove.side, bestScoutMove.flip, bestScoutMove.insertIndex);
      }

      // 否则优先演出压制
      // 筛选能够压制的最佳牌：优先出张数多的
      playableCombos.sort((a, b) => {
        if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length;
        return a.combo.value - b.combo.value; // 同样张数尽量出较小的能压过的牌，保留更大底牌
      });

      const chosen = playableCombos[0];
      const indices = [];
      for (let i = chosen.startIndex; i <= chosen.endIndex; i++) indices.push(i);
      return game.playShow(botPlayer.id, indices);
    }

    // 如果打不出任何牌，必须进行 Scout
    if (bestScoutMove) {
      // 检查是否有机会用 Scout & Show
      if (botPlayer.hasScoutAndShow) {
        // 模拟插入后，看是否能产生长度 >= 3 的强力组合
        const newCombos = findAllPlayableCombos(bestScoutMove.resultingHand, null);
        const bigCombo = newCombos.find(c => c.cards.length >= 3);
        if (bigCombo) {
          const showIndices = [];
          for (let i = bigCombo.startIndex; i <= bigCombo.endIndex; i++) showIndices.push(i);
          return game.playScoutAndShow(
            botPlayer.id,
            { side: bestScoutMove.side, flip: bestScoutMove.flip, insertIndex: bestScoutMove.insertIndex },
            showIndices
          );
        }
      }

      return game.playScout(botPlayer.id, bestScoutMove.side, bestScoutMove.flip, bestScoutMove.insertIndex);
    }

    // 极端保护：兜底跳过
    game.nextTurn();
  }
}

module.exports = ScoutAI;

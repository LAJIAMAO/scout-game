(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScoutRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const flipCard = c => ({id: c.id, top: c.bottom, bottom: c.top});
  const rotateHand = h => [...h].reverse().map(flipCard);
  function analyzeCombo(cards) {
    if (!Array.isArray(cards) || !cards.length || cards.some(c => !c || !Number.isInteger(c.top) || c.top < 1 || c.top > 10)) return null;
    const ns = cards.map(c => c.top), count = ns.length;
    if (ns.every(n => n === ns[0])) return {type:'set', count, value:ns[0], label:count === 1 ? `单张 ${ns[0]}` : `${count} 张同号 · ${ns[0]}`};
    if (ns.every((n,i) => !i || n === ns[i-1]+1) || ns.every((n,i) => !i || n === ns[i-1]-1))
      return {type:'run', count, value:Math.min(...ns), label:`${count} 张顺子 · ${Math.min(...ns)}–${Math.max(...ns)}`};
    return null;
  }
  function canBeat(a,b) {
    if (!a) return false;
    if (!b) return true;
    if (a.count !== b.count) return a.count > b.count;
    if (a.type !== b.type) return a.type === 'set';
    return a.value > b.value;
  }
  function validIndices(indices, length) {
    if (!Array.isArray(indices) || !indices.length || indices.length > length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= length)) return false;
    const sorted = [...indices].sort((a,b)=>a-b);
    return sorted.every((n,i) => !i || n === sorted[i-1]+1);
  }
  function selection(hand, indices, stage) {
    if (!validIndices(indices, hand.length)) return {success:false, msg:'请选择连续相邻的手牌'};
    const start = Math.min(...indices), cards = hand.slice(start,start+indices.length), combo = analyzeCombo(cards);
    if (!combo) return {success:false, msg:'所选手牌需要组成同号或连续顺子'};
    if (!canBeat(combo, stage)) return {success:false, msg:`${combo.label} 无法压过当前表演`};
    return {success:true, start, cards, combo};
  }
  function findAllPlayableCombos(hand, stage) {
    const out=[];
    for (let i=0;i<hand.length;i++) for(let j=i;j<hand.length;j++) {
      const cards=hand.slice(i,j+1), combo=analyzeCombo(cards);
      if(canBeat(combo,stage)) out.push({start:i, indices:Array.from({length:j-i+1},(_,k)=>i+k), cards, combo});
    }
    return out;
  }
  function previewScout(hand, stageCards, data) {
    if (!data || !['left','right'].includes(data.side) || typeof data.flip !== 'boolean' || !Number.isInteger(data.insertIndex) || data.insertIndex<0 || data.insertIndex>hand.length || !stageCards?.length)
      return {success:false, msg:'请选择有效的舞台端点、方向和插入位置'};
    const remaining=stageCards.map(c=>({...c}));
    let card=data.side==='left'?remaining.shift():remaining.pop();
    if(data.flip) card=flipCard(card);
    const newHand=hand.map(c=>({...c})); newHand.splice(data.insertIndex,0,card);
    return {success:true, hand:newHand, remaining, card, combo:analyzeCombo(remaining)};
  }
  function cohesion(hand) {
    let score=0;
    for(let i=0;i<hand.length-1;i++) {const d=Math.abs(hand[i].top-hand[i+1].top);score+=d===0?4:d===1?3:0;}
    for(const c of findAllPlayableCombos(hand,null)) if(c.cards.length>=3) score+=c.cards.length*2;
    return score;
  }
  return {flipCard, rotateHand, analyzeCombo, canBeat, validIndices, selection, findAllPlayableCombos, previewScout, cohesion};
});

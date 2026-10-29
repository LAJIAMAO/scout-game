'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/rules'),{deckFor,deal}=require('../game/cards'),Game=require('../game/scoutGame'),AI=require('../game/ai');
function rng(seed){return()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
const c=(id,top,bottom=10)=>({id,top,bottom});
function fixture(count=3){const g=new Game('TEST');for(let i=0;i<count;i++)g.addPlayer(`p${i}`,`演员${i}`,true);g.phase='PLAYING';g.maxRounds=count;g.round=1;g.players.forEach((p,i)=>p.hand=[c(10+i*3,1,8),c(11+i*3,2,7),c(12+i*3,9,3)]);g.activePlayerIndex=0;return g;}
function show(g,cards,owner='p2'){g.currentShow={cards,combo:R.analyzeCombo(cards),playerId:owner,playerName:owner};}
test('2–5 人牌库、逐张发牌、双人预留牌不重复',()=>{
  for(let n=2;n<=5;n++){
    const deck=deckFor(n,rng(8)),d=deal(deck,n),length=n===3?12:n===5?9:11;
    assert.equal(deck.length,n===3?36:n===5?45:44);assert.equal(d.hands.length,n);d.hands.forEach(h=>assert.equal(h.length,length));
    const ids=[...d.hands.flat(),...d.reserve].map(c=>c.id);assert.equal(new Set(ids).size,deck.length);
    if(n===3)assert.ok(deck.every(c=>c.top!==10&&c.bottom!==10));
    if(n===2){assert.equal(d.reserve.length,22);const second=deal(d.reserve,2);assert.equal(second.reserve.length,0);assert.ok(second.hands.flat().every(c=>!d.hands.flat().some(a=>a.id===c.id)));}
  }
});
test('同号、递增递减顺子、优先级及非法索引',()=>{
  const combo=ns=>R.analyzeCombo(ns.map((n,i)=>c(i,n)));
  assert.equal(combo([5,4,3]).type,'run');assert.equal(combo([5,4,3]).value,3);assert.equal(combo([2,4]),null);
  assert.ok(R.canBeat(combo([1,2,3]),combo([9,9])));assert.ok(R.canBeat(combo([2,2]),combo([8,9])));assert.equal(R.canBeat(combo([2,2]),combo([2,2])),false);
  for(const indices of [[],[0,0],[-1],[3],[0,2],[.1],['1'],[NaN],null])assert.equal(R.validIndices(indices,3),false);
  assert.ok(R.validIndices([2,1],3));
});
test('整手旋转同时反转牌序，旋转两次恢复，准备后锁定',()=>{
  const g=fixture();g.phase='PREPARE';const before=structuredClone(g.players[0].hand);
  assert.ok(g.flipHand('p0').success);assert.deepEqual(g.players[0].hand,R.rotateHand(before));
  assert.ok(g.flipHand('p0').success);assert.deepEqual(g.players[0].hand,before);
  g.setReady('p0');assert.equal(g.flipHand('p0').success,false);
});
test('挖角立即降低舞台张数及牌型，拿空舞台后新演出合法',()=>{
  const g=fixture();show(g,[c(1,5),c(2,6),c(3,7)]);
  assert.ok(g.playScout('p0','left',false,1).success);assert.equal(g.currentShow.combo.count,2);assert.equal(g.currentShow.combo.value,6);assert.equal(g.players[2].scoutChips,1);
  assert.ok(g.playShow('p1',[0,1,2]).success===false); // 1,2,9 is not a run.
  const h=fixture();show(h,[c(1,9)]);h.playScout('p0','left',false,0);assert.equal(h.currentShow,null);assert.ok(h.playShow('p1',[0]).success);
});
test('特殊行动所有失败路径保持完整状态，包括翻面与筹码',()=>{
  const g=fixture();show(g,[c(1,7,4),c(2,7,5)]);
  const before=JSON.stringify(g);
  for(const data of [null,{side:'middle',flip:true,insertIndex:0},{side:'left',flip:'yes',insertIndex:0},{side:'left',flip:true,insertIndex:-1},{side:'left',flip:true,insertIndex:NaN}]){
    assert.equal(g.playScoutAndShow('p0',data,[0]).success,false);assert.equal(JSON.stringify(g),before);
  }
  for(const indices of [[],[-1],[0,0],[0,2],[1]]){
    assert.equal(g.playScoutAndShow('p0',{side:'left',flip:true,insertIndex:0},indices).success,false);assert.equal(JSON.stringify(g),before);
  }
  assert.equal(g.playScout('p0','left',false,4).success,false);assert.equal(JSON.stringify(g),before);
});
test('特殊行动比较剩余舞台且仅消费一次，普通演出不能越权',()=>{
  const g=fixture();g.players[0].hand=[c(10,5,1),c(11,6,2),c(12,9,3)];show(g,[c(1,4,8),c(2,4,9)]);
  assert.ok(g.playScoutAndShow('p0',{side:'left',flip:false,insertIndex:0},[0,1,2]).success);
  assert.equal(g.players[0].hasScoutAndShow,false);assert.equal(g.players[0].scorePile.length,1);assert.equal(g.players[2].scoutChips,1);assert.equal(g.currentShow.combo.count,3);
  assert.equal(g.playShow('p0',[0]).success,false);
});
test('多人连续挖角结束，舞台主人免扣，最后轮保留计分且不重复加分',()=>{
  const g=fixture();g.round=3;show(g,[c(1,7),c(2,7),c(3,7),c(4,7)]);
  g.playScout('p0','left',false,0);g.playScout('p1','right',false,0);
  assert.equal(g.phase,'GAME_OVER');assert.equal(g.lastRoundResult.triggerType,'LOOP');assert.equal(g.lastRoundResult.scores[2].handPenalty,0);assert.equal(g.players[2].totalScore,2);
  const scores=g.players.map(p=>p.totalScore);g.endRound('LOOP','p2');assert.deepEqual(g.players.map(p=>p.totalScore),scores);
});
test('双人花费筹码后继续行动、禁特殊行动、堵死判定与第二轮预留牌',()=>{
  const g=fixture(2);g.players.forEach(p=>{p.scoutChips=3;p.hasScoutAndShow=false;});show(g,[c(1,8),c(2,8)],'p1');
  assert.ok(g.playScout('p0','left',false,1).success);assert.equal(g.activePlayerIndex,0);assert.equal(g.players[0].scoutChips,2);assert.equal(g.players[1].scoutChips,3);assert.equal(g.playScoutAndShow('p0',{},[]).success,false);
  const h=fixture(2);h.players[0].scoutChips=0;show(h,[c(1,10),c(2,10)],'p1');h.checkDuelBlocked();assert.equal(h.phase,'ROUND_OVER');assert.equal(h.lastRoundResult.triggerType,'BLOCKED');assert.equal(h.lastRoundResult.scores[1].handPenalty,0);
  const k=new Game('DUEL');k.addPlayer('a','a',true);k.addPlayer('b','b',true);k.startNewGame(rng(42));const first=new Set(k.players.flatMap(p=>p.hand.map(c=>c.id)));const reserved=k.reserve.map(c=>c.id);k.phase='ROUND_OVER';k.startRound(rng(99));assert.deepEqual(k.players.flatMap(p=>p.hand.map(c=>c.id)).sort((a,b)=>a-b),reserved.sort((a,b)=>a-b));assert.ok(k.players.every(p=>p.hand.every(c=>!first.has(c.id))));
});
test('客户端视角不泄露对手手牌或会话凭证，AI不依赖隐藏牌',()=>{
  const g=fixture();g.players[1].tokenHash='SECRET';const state=g.getClientState('p0'),json=JSON.stringify(state);
  assert.equal(json.includes('SECRET'),false);assert.equal('hand' in state.players[1],false);
  const one=AI.choose(state,'hard',rng(1));g.players[1].hand=[c(45,10,1)];const altered=g.getClientState('p0');altered.players[1].handCount=state.players[1].handCount;assert.deepEqual(AI.choose(altered,'hard',rng(1)),one);
});
test('双人整轮仅有三次挖角：每次一张，第四次及组合行动拒绝，演出后不重置，次轮才补足',()=>{
  const g=new Game('DUELCAP');g.addPlayer('p0','A');g.addPlayer('p1','B');g.startNewGame(rng(19));g.phase='PLAYING';g.activePlayerIndex=0;
  g.players[0].hand=[c(20,1,2)];g.players[1].hand=[c(21,1,3)];show(g,[c(1,7,2),c(2,7,3),c(3,7,4),c(4,7,5)],'p1');
  assert.equal(g.getClientState('p0').rules.allowScoutAndShow,false);
  let before=JSON.stringify(g);assert.equal(g.playScoutAndShow('p0',{side:'left',flip:false,insertIndex:1},[0]).success,false);assert.equal(JSON.stringify(g),before);
  for(let i=0;i<3;i++){
    const handCount=g.players[0].hand.length,stageCount=g.currentShow.cards.length;
    const res=g.playScout('p0',i%2?'right':'left',false,g.players[0].hand.length);
    assert.ok(res.success);assert.equal(res.taken,1);assert.equal(res.turnEnded,false);assert.equal(res.remainingScouts,2-i);
    assert.equal(g.players[0].hand.length,handCount+1);assert.equal(g.currentShow.cards.length,stageCount-1);assert.equal(g.activePlayerIndex,0);
    assert.equal(g.players[0].scoutChips,2-i);assert.equal(g.players[1].scoutChips,3);assert.equal(g.getClientState('p0').players[0].scoutsRemaining,2-i);
  }
  before=JSON.stringify(g);const fourth=g.playScout('p0','left',false,0);assert.equal(fourth.success,false);assert.equal(JSON.stringify(g),before);
  assert.ok(g.playShow('p0',[1,2,3]).success);assert.equal(g.activePlayerIndex,1);assert.equal(g.players[0].scoutChips,0);
  // A later turn in this round must not restore the budget.
  g.activePlayerIndex=0;before=JSON.stringify(g);assert.equal(g.playScout('p0','left',false,0).success,false);assert.equal(JSON.stringify(g),before);
  const restored=Game.restore(JSON.parse(JSON.stringify(g)));assert.equal(restored.playScout('p0','left',false,0).success,false);
  g.endRound('BLOCKED','p1');assert.ok(g.startRound(rng(7)).success);assert.equal(g.round,2);assert.ok(g.players.every(p=>p.scoutChips===3&&!p.hasScoutAndShow));
});
test('双人次数用尽且不能演出立即结算，未用筹码计分；多人普通挖角仍立即换人',()=>{
  const g=fixture(2);g.players[0].hand=[c(20,1,2)];g.players.forEach(p=>{p.scoutChips=3;p.hasScoutAndShow=false;});
  show(g,[c(1,7,2),c(2,7,3),c(3,7,4),c(4,7,5),c(5,7,6),c(6,7,8)],'p1');
  for(let i=0;i<3;i++)assert.ok(g.playScout('p0','left',false,0).success);
  assert.equal(g.phase,'ROUND_OVER');assert.equal(g.lastRoundResult.triggerType,'BLOCKED');assert.equal(g.lastRoundResult.scores[1].chipPoints,3);assert.equal(g.lastRoundResult.scores[1].handPenalty,0);
  for(let n=3;n<=5;n++){const k=fixture(n);show(k,[c(1,7),c(2,7),c(3,7)]);const len=k.players[0].hand.length;const res=k.playScout('p0','left',false,0);assert.ok(res.success);assert.equal(res.turnEnded,true);assert.equal(k.players[0].hand.length,len+1);assert.equal(k.activePlayerIndex,1);assert.equal(k.playShow('p0',[0]).success,false);}
});
test('固定种子 48 场完整对局：合法执行、卡牌守恒、正常结束、计分一致',()=>{
  let totalActions=0;
  for(let n=2;n<=5;n++)for(let seed=1;seed<=12;seed++){
    const random=rng(seed),g=new Game('SIM');for(let i=0;i<n;i++)g.addPlayer(`p${i}`,`电脑${i}`,true,['easy','normal','hard'][i%3]);g.startNewGame(random);
    let actions=0;
    while(g.phase!=='GAME_OVER'&&actions<1500){
      if(g.phase==='PREPARE'){for(const p of g.players){if(AI.prepare(p.hand))g.flipHand(p.id);g.setReady(p.id);}}
      else if(g.phase==='ROUND_OVER')g.startRound(random);
      else{
        const p=g.players[g.activePlayerIndex],state=g.getClientState(p.id),move=AI.choose(state,p.difficulty,random);assert.ok(move,`无行动 ${n}人 seed${seed}`);
        let res;if(move.event==='action_show')res=g.playShow(p.id,move.data.selectedIndices);else if(move.event==='action_scout')res=g.playScout(p.id,move.data.side,move.data.flip,move.data.insertIndex);else res=g.playScoutAndShow(p.id,move.data.scoutData,move.data.showIndices);
        assert.ok(res.success,res.msg);actions++;
      }
      const cards=[...g.players.flatMap(p=>[...p.hand,...p.scorePile]),...(g.currentShow?.cards||[]),...g.reserve];
      assert.equal(cards.length,n===2?(g.round===1?44:22):n===3?36:n===4?44:45);assert.equal(new Set(cards.map(c=>c.id)).size,cards.length);
      if(g.currentShow)assert.deepEqual(g.currentShow.combo,R.analyzeCombo(g.currentShow.cards));
    }
    assert.equal(g.phase,'GAME_OVER',`未结束 ${n}人 seed${seed}`);assert.equal(g.history.length,n);
    for(const p of g.players)assert.equal(p.totalScore,g.history.reduce((sum,r)=>sum+r.scores.find(s=>s.id===p.id).netScore,0));
    totalActions+=actions;
  }
  console.log(`完整对局 48 场，总计 ${totalActions} 次有效行动`);
});

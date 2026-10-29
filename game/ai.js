'use strict';
const R=require('../public/rules');
// This module accepts only a client perspective: private hands of opponents never enter the policy.
function candidates(state){
  const me=state.players.find(p=>p.id===state.myPlayerId),hand=state.myHand,stage=state.currentShow;
  const out=R.findAllPlayableCombos(hand,stage?.combo).map(c=>({event:'action_show',data:{selectedIndices:c.indices},remaining:hand.filter((_,i)=>!c.indices.includes(i)),removed:c.cards.length,points:stage?.cards.length||0,label:`演出 ${c.combo.label}`}));
  if(stage&&(state.players.length!==2||me.scoutChips>0))for(const side of stage.cards.length===1?['left']:['left','right'])for(const flip of [false,true])for(let insertIndex=0;insertIndex<=hand.length;insertIndex++){
    const data={side,flip,insertIndex},v=R.previewScout(hand,stage.cards,data);
    out.push({event:'action_scout',data,remaining:v.hand,removed:-1,points:0,label:`从${side==='left'?'左':'右'}端挖角${flip?'并翻面':''}，插入第 ${insertIndex+1} 个位置`});
    if(state.players.length>2&&me.hasScoutAndShow)for(const c of R.findAllPlayableCombos(v.hand,v.combo))out.push({event:'action_scout_and_show',data:{scoutData:data,showIndices:c.indices},remaining:v.hand.filter((_,i)=>!c.indices.includes(i)),removed:c.cards.length-1,points:v.remaining.length,label:`挖角后演出 ${c.combo.label}`});
  }
  return out;
}
function choose(state,difficulty='normal',random=Math.random){
  const moves=candidates(state);if(!moves.length)return null;
  const winners=moves.filter(m=>!m.remaining.length);if(winners.length)return winners[0];
  if(difficulty==='easy'){
    const shows=moves.filter(m=>m.event==='action_show');const pool=shows.length?shows:moves.filter(m=>m.event==='action_scout');
    return pool[Math.floor(random()*pool.length)];
  }
  const minOther=Math.min(...state.players.filter(p=>p.id!==state.myPlayerId).map(p=>p.handCount));
  for(const m of moves){
    m.value=m.removed*5+m.points*2+R.cohesion(m.remaining)*.65-(m.event==='action_scout_and_show'?3:0);
    if(m.event==='action_scout'&&state.currentShow&&state.players.length>2){
      // A surviving show may end the round after this Scout; account for public score and hand penalty.
      const owner=state.currentShow.playerId,actor=state.players.findIndex(p=>p.id===state.myPlayerId),next=state.players[(actor+1)%state.players.length];
      if(next.id===owner&&state.currentShow.cards.length>1)m.value-=18;
    }
    if(difficulty==='hard'){
      const groups=R.findAllPlayableCombos(m.remaining,null),longest=Math.max(0,...groups.map(c=>c.cards.length));
      m.value+=longest*2-m.remaining.length*.8;
      if(minOther<=2&&m.event==='action_scout')m.value-=8;
      if(state.players.length===2&&m.event==='action_scout')m.value-=4;
    }
  }
  return moves.sort((a,b)=>b.value-a.value)[0];
}
function prepare(hand){return R.cohesion(R.rotateHand(hand))>R.cohesion(hand);}
module.exports={candidates,choose,prepare};

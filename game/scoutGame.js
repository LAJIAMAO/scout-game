'use strict';
const R=require('../public/rules');
const {deckFor,deal}=require('./cards');
const fail=msg=>({success:false,msg});
class ScoutGame {
  constructor(roomId,settings={}) {
    this.roomId=roomId;this.players=[];this.hostId=null;this.phase='LOBBY';this.round=0;this.maxRounds=0;
    this.startingPlayerIndex=0;this.activePlayerIndex=0;this.currentShow=null;this.consecutiveScouts=0;
    this.logs=[];this.history=[];this.lastRoundResult=null;this.reserve=[];this.version=0;
    this.settings={practice:!!settings.practice,allowHints:!!settings.practice||!!settings.allowHints,difficulty:['easy','normal','hard'].includes(settings.difficulty)?settings.difficulty:'normal'};
  }
  log(text){this.logs.unshift(text);this.logs=this.logs.slice(0,60);}
  addPlayer(id,name,isBot=false,difficulty=this.settings.difficulty) {
    if(this.phase!=='LOBBY'||this.players.length>=5||this.players.some(p=>p.id===id)) return false;
    this.players.push({id,name,isBot,difficulty,connected:!isBot,disconnectedAt:null,controlled:false,left:false,hand:[],scorePile:[],scoutChips:0,hasScoutAndShow:true,isReady:false,totalScore:0,roundScore:0});
    if(!this.hostId&&!isBot)this.hostId=id;
    this.log(`${name} 加入了马戏团`);return true;
  }
  startNewGame(random=Math.random){
    if(this.players.length<2||this.players.length>5)return fail('需要 2–5 位玩家');
    if(!['LOBBY','GAME_OVER'].includes(this.phase))return fail('请完成当前对局');
    const remaining=this.players.filter(p=>!p.left);
    if(remaining.length<2)return fail('请回大厅补充玩家');
    this.players=remaining;
    this.maxRounds=this.players.length;this.round=0;this.history=[];this.reserve=[];
    this.players.forEach(p=>p.totalScore=0);
    this.startingPlayerIndex=Math.floor(random()*this.players.length);
    return this.startRound(random);
  }
  startRound(random=Math.random){
    if(this.round && this.phase!=='ROUND_OVER')return fail('当前不能进入下一轮');
    if(this.round>=this.maxRounds)return fail('对局已经结束');
    this.round++;this.currentShow=null;this.consecutiveScouts=0;this.lastRoundResult=null;
    const d=deal(this.players.length===2&&this.round===2?this.reserve:deckFor(this.players.length,random),this.players.length);
    this.reserve=d.reserve;
    this.players.forEach((p,i)=>{p.hand=d.hands[i];p.scorePile=[];p.scoutChips=this.players.length===2?3:0;p.hasScoutAndShow=this.players.length>2;p.isReady=false;p.roundScore=0;});
    this.activePlayerIndex=(this.startingPlayerIndex+this.round-1)%this.players.length;
    this.phase='PREPARE';this.log(`第 ${this.round} / ${this.maxRounds} 轮 · 选择手牌方向`);
    return {success:true};
  }
  flipHand(id){
    const p=this.players.find(p=>p.id===id);
    if(this.phase!=='PREPARE'||!p||p.isReady)return fail('仅可在确认准备前旋转整手牌');
    p.hand=R.rotateHand(p.hand);return {success:true};
  }
  setReady(id){
    const p=this.players.find(p=>p.id===id);
    if(this.phase!=='PREPARE'||!p||p.isReady)return fail('当前无法准备');
    p.isReady=true;
    if(this.players.every(p=>p.isReady)){this.phase='PLAYING';this.log(`${this.players[this.activePlayerIndex].name} 首先演出`);}
    return {success:true};
  }
  checkTurn(id){
    if(this.phase!=='PLAYING')return fail('当前不是行动阶段');
    if(this.players[this.activePlayerIndex]?.id!==id)return fail('请等待自己的回合');
    return {success:true};
  }
  playShow(id,indices){
    const turn=this.checkTurn(id);if(!turn.success)return turn;
    const p=this.players[this.activePlayerIndex];const v=R.selection(p.hand,indices,this.currentShow?.combo);
    if(!v.success)return v;
    const points=this.currentShow?.cards.length||0;
    if(points)p.scorePile.push(...this.currentShow.cards);
    p.hand.splice(v.start,v.cards.length);this.currentShow={cards:v.cards,combo:v.combo,playerId:id,playerName:p.name};
    this.consecutiveScouts=0;this.log(`${p.name} 演出 ${v.combo.label}${points?` · 收入 ${points} 分`:''}`);
    if(!p.hand.length)this.endRound('EMPTY_HAND',id);
    else {this.nextTurn();this.checkDuelBlocked();}
    return {success:true};
  }
  playScout(id,side,flip=false,insertIndex=0){
    const turn=this.checkTurn(id);if(!turn.success)return turn;
    const p=this.players[this.activePlayerIndex],duel=this.players.length===2;
    if(duel&&p.scoutChips<=0)return fail('本轮 3 次挖角已用完，只能演出；无法演出时本轮结束');
    const v=R.previewScout(p.hand,this.currentShow?.cards,{side,flip,insertIndex});if(!v.success)return v;
    const owner=this.players.find(p=>p.id===this.currentShow.playerId);
    p.hand=v.hand;if(duel)p.scoutChips--;else owner.scoutChips++;
    if(v.remaining.length)this.currentShow={...this.currentShow,cards:v.remaining,combo:v.combo};else this.currentShow=null;
    this.log(`${p.name} 从${side==='left'?'左':'右'}端挖角 1 张（${v.card.top}）${duel?` · 本轮还可挖角 ${p.scoutChips} 次，继续行动`:` · ${owner.name} 获得 1 筹码，行动结束`}`);
    if(!this.currentShow)this.consecutiveScouts=0;else this.consecutiveScouts++;
    if(duel)this.checkDuelBlocked();
    else if(this.currentShow&&this.consecutiveScouts>=this.players.length-1)this.endRound('LOOP',owner.id);
    else this.nextTurn();
    return {success:true,action:'scout',taken:1,remainingScouts:duel?p.scoutChips:null,turnEnded:!duel||this.phase!=='PLAYING',roundEnded:this.phase!=='PLAYING'};
  }
  playScoutAndShow(id,data,indices){
    const turn=this.checkTurn(id);if(!turn.success)return turn;
    const p=this.players[this.activePlayerIndex];
    if(this.players.length===2)return fail('双人局只能选择演出或挖角，不能使用挖角并演出');
    if(!p.hasScoutAndShow)return fail('本轮的挖角并演出已使用');
    const preview=R.previewScout(p.hand,this.currentShow?.cards,data);if(!preview.success)return preview;
    const v=R.selection(preview.hand,indices,preview.combo);if(!v.success)return v;
    // No live object is touched before both halves have passed validation.
    this.players.find(q=>q.id===this.currentShow.playerId).scoutChips++;
    p.hand=preview.hand;p.hand.splice(v.start,v.cards.length);p.scorePile.push(...preview.remaining);p.hasScoutAndShow=false;
    this.currentShow={cards:v.cards,combo:v.combo,playerId:id,playerName:p.name};this.consecutiveScouts=0;
    this.log(`${p.name} 使用挖角并演出 · ${v.combo.label}`);
    if(!p.hand.length)this.endRound('EMPTY_HAND',id);else this.nextTurn();
    return {success:true};
  }
  nextTurn(){this.activePlayerIndex=(this.activePlayerIndex+1)%this.players.length;}
  checkDuelBlocked(){
    if(this.players.length!==2||this.phase!=='PLAYING')return;
    const p=this.players[this.activePlayerIndex];
    if(p.scoutChips===0&&!R.findAllPlayableCombos(p.hand,this.currentShow?.combo).length)this.endRound('BLOCKED',this.currentShow.playerId);
  }
  endRound(type,id){
    if(this.phase!=='PLAYING')return;
    const winner=this.players.find(p=>p.id===id);
    const scores=this.players.map(p=>{
      const isExempt=type!=='EMPTY_HAND'&&p.id===id,handPenalty=isExempt?0:p.hand.length;
      p.roundScore=p.scorePile.length+p.scoutChips-handPenalty;p.totalScore+=p.roundScore;
      return {id:p.id,name:p.name,showPoints:p.scorePile.length,chipPoints:p.scoutChips,handPenalty,isExempt,netScore:p.roundScore,totalScore:p.totalScore};
    });
    this.lastRoundResult={round:this.round,triggerType:type,triggerPlayerName:winner.name,scores};
    this.history.push(this.lastRoundResult);this.phase=this.round===this.maxRounds?'GAME_OVER':'ROUND_OVER';
    this.log(`${winner.name} ${type==='EMPTY_HAND'?'清空手牌':type==='BLOCKED'?'使对手无法行动':'演出无人压过'} · 本轮结束`);
  }
  getClientState(id){
    const me=this.players.find(p=>p.id===id);
    const duel=this.players.length===2;
    return {appVersion:require('../package.json').version,roomId:this.roomId,phase:this.phase,round:this.round,maxRounds:this.maxRounds,version:this.version,settings:this.settings,
      rules:{mode:duel?'duel':'classic',label:duel?'双人规则':'经典规则',scoutEndsTurn:!duel,scoutLimitPerRound:duel?3:null,allowScoutAndShow:!duel},
      hostId:this.hostId,activePlayerId:this.players[this.activePlayerIndex]?.id,currentShow:this.currentShow,logs:this.logs.slice(0,25),
      history:this.history,lastRoundResult:this.lastRoundResult,myHand:me?.hand||[],myPlayerId:id,
      players:this.players.map(p=>({id:p.id,name:p.name,isBot:p.isBot,difficulty:p.difficulty,connected:p.connected,controlled:p.controlled,left:p.left,disconnectedAt:p.disconnectedAt,
        isHost:this.hostId===p.id,handCount:p.hand.length,scorePileCount:p.scorePile.length,scoutChips:p.scoutChips,scoutsRemaining:duel?p.scoutChips:null,hasScoutAndShow:!duel&&p.hasScoutAndShow,isReady:p.isReady,totalScore:p.totalScore,roundScore:p.roundScore}))};
  }
  static restore(raw){return Object.assign(new ScoutGame(raw.roomId,raw.settings),raw);}
}
module.exports=ScoutGame;

'use strict';
(() => {
// Opening index.html directly has no Socket.IO service. Explain the entry point instead of leaving a frozen status.
if(location.protocol==='file:' || typeof window.io!=='function'){
  const directFile=location.protocol==='file:';
  document.getElementById('connection').textContent=directFile?'请先启动游戏':'连接组件未加载';
  const panel=document.createElement('section');panel.className='paper connection-help';panel.setAttribute('role','alert');
  const title=document.createElement('h2');title.textContent=directFile?'请从启动入口进入游戏':'游戏连接组件没有加载成功';
  const message=document.createElement('p');message.textContent=directFile?'你直接打开了网页文件。请返回游戏主文件夹，双击“启动游戏.bat”，使用它自动打开的浏览器页面，并保持启动窗口运行。':'请刷新此页面，并确认游戏启动窗口仍在运行。若文件未解压完整，请重新解压完整游戏包。';
  panel.append(title,message);
  if(directFile){const link=document.createElement('a');link.href='http://localhost:3210/';link.textContent='已经启动？打开本机游戏页面 →';panel.append(link);}
  document.getElementById('app').prepend(panel);
  document.querySelectorAll('button').forEach(button=>button.disabled=true);
  return;
}
const $=id=>document.getElementById(id),R=window.ScoutRules,P=window.ScoutPresentation;
if(location.protocol==='https:'&&!['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname)){
  document.querySelector('.intro-meta span:last-child').textContent='好友在线联机';
  document.querySelector('.entry-note').textContent='分享房间链接，手机或电脑浏览器即可加入。';
  $('footer').querySelector('span').textContent='在线版 / v2.0.3';
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls,action,disabled=false)=>{const b=el('button',cls,text);b.disabled=disabled;b.addEventListener('click',action);return b;};
const levelName={easy:'入门',normal:'标准',hard:'挑战'};
let state=null,pending=false,draft=null,selected=new Set(),resultKey='',toastTimer,tutorial=null,network=null,hintSetting=null;
let serverOffset=0,presentationTimers=[],lastTurnNotice='',lastActionSound='';
const animatedFlights=new Set();
function serverNow(){return Date.now()+serverOffset;}
function actionPhase(){return !tutorial&&state?.lastAction?P.phaseAt(state.lastAction,serverNow()):'done';}
function presentationLocked(){return !tutorial&&state&&(state.presentationUntil||0)>serverNow();}
function schedulePresentation(){
  presentationTimers.forEach(clearTimeout);presentationTimers=[];
  const a=!tutorial&&state?.lastAction;if(!a)return;
  const times=P.milestones(a);if(a.roundEnded)times.push(a.until+1000,a.until+2000);
  for(const at of times)if(at>serverNow())presentationTimers.push(setTimeout(()=>{if(state?.lastAction?.id===a.id)render();},Math.max(1,at-serverNow()+25)));
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state){schedulePresentation();render();}});
let session=null;
try{session=JSON.parse(sessionStorage.getItem('scout-session')||'null');$('nickname').value=localStorage.getItem('scout-name')||'';}catch{}
let preferences={sound:true,volume:35,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
try{preferences={...preferences,...JSON.parse(localStorage.getItem('scout-preferences')||'{}')};}catch{}
function applyPreferences(){Sound.enabled=preferences.sound;Sound.volume=preferences.volume/100;document.body.classList.toggle('reduced-motion',preferences.reduced);$('sound-enabled').checked=preferences.sound;$('volume').value=preferences.volume;$('reduced-motion').checked=preferences.reduced;}
applyPreferences();
for(const id of ['sound-enabled','volume','reduced-motion'])$(id).addEventListener('input',()=>{preferences={sound:$('sound-enabled').checked,volume:Number($('volume').value),reduced:$('reduced-motion').checked};try{localStorage.setItem('scout-preferences',JSON.stringify(preferences));}catch{}applyPreferences();});
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function showDialog(id){if(!$(id).open)$(id).showModal();}
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('rules-open').addEventListener('click',()=>{syncRulesHelp();showDialog('rules-dialog');});
$('help-mode-duel').addEventListener('click',()=>syncRulesHelp(true));
$('help-mode-classic').addEventListener('click',()=>syncRulesHelp(false));
$('settings-open').addEventListener('click',()=>showDialog('settings-dialog'));
const socket=io({reconnection:true,reconnectionDelay:700,reconnectionDelayMax:4000});
function setConnected(online,text){$('connection').textContent=text;$('connection').classList.toggle('online',online);}
socket.on('connect',async()=>{
  setConnected(true,'已连接');pending=false;
  if(session&&!tutorial){const res=await request('room_rejoin',session);if(!res.success){session=null;try{sessionStorage.removeItem('scout-session');}catch{}state=null;render();toast(res.msg);} }
});
socket.on('disconnect',reason=>{pending=false;draft=null;selected.clear();setConnected(false,reason==='io server disconnect'?'连接已结束':'正在重连');render();});
socket.on('connect_error',()=>setConnected(false,'等待主机'));
socket.on('session_replaced',()=>{session=null;state=null;try{sessionStorage.removeItem('scout-session');}catch{}toast('这个座位已在另一个窗口恢复');render();});
socket.on('room_joined',data=>{
  session={roomId:data.roomId,token:data.token||session?.token};
  try{sessionStorage.setItem('scout-session',JSON.stringify(session));}catch{}
  history.replaceState(null,'',`?room=${data.roomId}`);
});
socket.on('game_state_update',next=>{
  if(tutorial)return;
  const previous=state;
  if(!state||next.version!==state.version){draft=null;selected.clear();}
  state=next;
  if(Number.isFinite(next.serverTime))serverOffset=next.serverTime-Date.now();
  const a=next.lastAction;
  if(a&&a.id!==lastActionSound&&serverNow()<a.until){lastActionSound=a.id;if(a.actorId!==next.myPlayerId)Sound.play(a.kind==='scout'?'scout':a.kind==='scout_show'?'combo':'show');}
  schedulePresentation();
  render();
});
function request(event,data={}){
  return new Promise(resolve=>{if(!socket.connected)return resolve({success:false,msg:'尚未连接主机，请稍候'});socket.timeout(7000).emit(event,data,(err,res)=>resolve(err?{success:false,msg:'等待主机确认超时，请查看牌桌是否已更新'}:res||{success:false,msg:'未收到主机确认'}));});
}
function myPlayer(){return state?.players.find(p=>p.id===state.myPlayerId);}
function isDuel(){return state?.rules?state.rules.mode==='duel':state?.players.length===2;}
function scoutsLeft(p=myPlayer()){return p?.scoutsRemaining??p?.scoutChips??0;}
function syncRulesHelp(duel=!!isDuel()){
  $('rules-dialog').classList.toggle('duel-help',duel);
  $('help-mode-duel').setAttribute('aria-pressed',String(duel));$('help-mode-classic').setAttribute('aria-pressed',String(!duel));
  $('rules-title').textContent=duel?'双人局，每回合只做一种行动。':'三种行动，一场好戏。';
  $('rule-scout-show').hidden=duel;
  $('rule-scout-desc').textContent=duel?'每次只取舞台一端的 1 张，花费 1 枚自己的筹码。每轮共 3 次；挖角完成即结束回合，轮到对手。不给对手筹码。':'取舞台任一端的 1 张，可翻转后插入手牌任意位置。原表演者得 1 筹码，你的回合结束。';
  $('round-end-rule').textContent=duel?'结束与计分：有人出完，或一方无法演出且挖角次数为 0 时，本轮结束。得分牌＋未用筹码－手牌；使对手无法行动的表演者免扣手牌。':'结束与计分：有人出完，或所有对手都只挖角而舞台仍有牌，本轮结束。得分牌＋筹码－手牌；舞台无人压过的表演者免扣手牌。';
}
function myTurn(){return state?.phase==='PLAYING'&&state.activePlayerId===state.myPlayerId&&(tutorial||socket.connected)&&!pending&&!presentationLocked();}
function host(){return state?.hostId===state?.myPlayerId;}
async function command(event,data={}){
  if(pending)return;
  if(tutorial)return tutorialCommand(event,data);
  pending=true;render();
  const actionId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
  const res=await request(event,{...data,version:state.version,actionId});pending=false;
  if(!res.success)toast(res.msg);else{draft=null;selected.clear();Sound.play(event==='action_scout'?'scout':event==='action_scout_and_show'?'combo':event==='action_show'?'show':'click');if(event==='action_scout'&&state.phase==='PLAYING')toast(isDuel()?`已挖角 1 张 · 本轮剩余 ${res.remainingScouts??scoutsLeft()} 次 · 本回合结束，轮到对手`:'已挖角 1 张 · 本回合结束，轮到下一位');}
  render();return res;
}
async function enter(practice=false,join=false){
  if(pending)return;
  const nickname=$('nickname').value.trim()||'团长',code=$('room-code').value.trim().toUpperCase();
  if(join&&!/^[A-Z2-9]{4}$/.test(code))return toast('请输入四位房间号');
  try{localStorage.setItem('scout-name',nickname);}catch{}
  pending=true;$('practice').disabled=$('create-room').disabled=$('join-room').disabled=true;
  const res=await request(join?'join_room':'create_room',join?{playerName:nickname,roomId:code}:{playerName:nickname,settings:{practice,difficulty:$('difficulty').value}});
  pending=false;$('practice').disabled=$('create-room').disabled=$('join-room').disabled=false;
  if(!res.success)toast(res.msg);render();
}
$('practice').addEventListener('click',()=>enter(true));$('create-room').addEventListener('click',()=>enter());$('join-room').addEventListener('click',()=>enter(false,true));
$('join-toggle').addEventListener('click',()=>{$('join-form').hidden=!$('join-form').hidden;if(!$('join-form').hidden)$('room-code').focus();});
$('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')enter(false,true);});
const queryRoom=new URLSearchParams(location.search).get('room');if(queryRoom){$('room-code').value=queryRoom.toUpperCase();$('join-form').hidden=false;}
function card(c,index=null,interactive=false){
  const n=el(interactive?'button':'div',`card n${c.top}`);
  n.dataset.cardId=c.id;n.append(el('span','card-top',c.top),el('i','card-symbol','✦'),el('span','card-bottom',c.bottom));
  if(index!==null)n.append(el('span','card-index',index+1));
  n.setAttribute('aria-label',`${index===null?'舞台牌':`第 ${index+1} 张`}，当前 ${c.top}，反向 ${c.bottom}`);
  if(interactive){n.setAttribute('aria-pressed',selected.has(index)?'true':'false');n.disabled=!myTurn();n.dataset.handIndex=index;n.classList.toggle('selected',selected.has(index));n.addEventListener('click',()=>{if(selected.has(index))selected.delete(index);else selected.add(index);Sound.play('click');renderHand();renderControls();});}
  return n;
}
function render(){
  if(state?.appVersion)$('app-version').textContent=`v${state.appVersion}`;
  $('home').hidden=!!state;$('lobby').hidden=!state||state.phase!=='LOBBY';$('game').hidden=!state||state.phase==='LOBBY';$('footer').hidden=!!state&&state.phase!=='LOBBY';
  if(!state){$('result-dialog').close();return;}
  if(state.phase==='LOBBY'){renderLobby();$('result-dialog').close();return;}
  renderTableTop();renderSeats();renderModeRules();renderStage();renderHand();renderControls();renderLogs();renderResult();
  if(myTurn()){const key=`${state.roomId}:${state.round}:${state.lastAction?.id||'start'}`;if(key!==lastTurnNotice){lastTurnNotice=key;Sound.play('turn');}}
}
function renderLobby(){
  const box=$('lobby');box.replaceChildren();
  const top=el('div','lobby-intro'),intro=el('div');intro.append(el('span','eyebrow','ASSEMBLE YOUR TROUPE'),el('h1',null,'演员就位，好戏将启。'),el('p','muted','等好友入场，或添加电脑补齐席位。'));
  const ticket=el('div','room-ticket');ticket.append(el('small',null,'ROOM / 房间号'),el('strong',null,state.roomId));top.append(intro,ticket);box.append(top);
  const paper=el('div','paper lobby-body');paper.append(el('span','eyebrow',`THE CAST · ${state.players.length} / 5`));
  const list=el('div','lobby-players');
  state.players.forEach((p,i)=>{
    const row=el('div','lobby-seat'),name=el('div','seat-name');name.append(el('strong',null,`${p.name}${p.id===state.myPlayerId?' · 你':''}`),el('small',null,p.isBot?`${levelName[p.difficulty]}电脑`:p.connected?'已入场':'离线 · 等待恢复'));
    row.append(el('div','avatar',['✦','♣','♦','♠','♥'][i]),name);
    if(p.isHost)row.append(el('span','badge','团长 / 房主'));
    if(p.isBot&&host())row.append(button('移除','quiet',()=>command('remove_bot',{botId:p.id}),pending));
    list.append(row);
  });paper.append(list);
  if(isDuel())paper.append(el('p','duel-lobby-note','双人规则：演出或挖角二选一；每轮每人最多挖角 3 次，每次 1 张，挖角后立即换人。不使用“挖角并演出”。'));
  if(host()){
    const actions=el('div','lobby-buttons'),difficulty=$('difficulty').cloneNode(true);difficulty.id='bot-difficulty';difficulty.setAttribute('aria-label','新增电脑难度');difficulty.value=state.settings.difficulty;
    actions.append(difficulty,button('＋ 添加电脑','secondary',()=>command('add_bot',{difficulty:difficulty.value}),pending||state.players.length>=5),button('拉开帷幕 →','primary',()=>command('start_game'),pending||state.players.length<2));paper.append(actions);
    const label=el('label','setting-line'),check=el('input');check.type='checkbox';check.checked=hintSetting??state.settings.allowHints;check.disabled=pending;check.addEventListener('change',async()=>{hintSetting=check.checked;try{await command('update_settings',{allowHints:hintSetting});}finally{hintSetting=null;render();}});label.append(el('span',null,'为所有玩家开启行动建议'),check);paper.append(label);
  }else paper.append(el('p','muted','等待房主开始。开局后，每位玩家先确认手牌方向。'));
  const foot=el('div','lobby-foot');foot.append(button('邀请好友 ↗','text-button',openShare),button('离开房间','quiet',()=>showDialog('leave-dialog')));paper.append(foot);box.append(paper);
}
function renderTableTop(){
  const box=$('table-top');box.className='table-top';box.replaceChildren();const left=el('div');
  if(tutorial)left.append(el('span','tutorial-badge',`教学 ${tutorial.step+1} / 5`));
  else left.append(el('strong',null,`第 ${state.round} / ${state.maxRounds} 轮`),el('span','table-label',`　${state.players.length===2?'双人专用规则':'经典模式'} · 房间 ${state.roomId}`));
  const right=el('div','table-top-actions');
  if(!tutorial)right.append(button(`房间 ${state.roomId}`,'quiet',openShare));
  if(['ROUND_OVER','GAME_OVER'].includes(state.phase))right.append(button(presentationLocked()?'谢幕中…':'查看结算','quiet',()=>showDialog('result-dialog'),presentationLocked()));
  right.append(button(tutorial?'跳过教学':'离开','quiet',()=>tutorial?exitTutorial():showDialog('leave-dialog')));box.append(left,right);
}
function renderModeRules(){
  const box=$('mode-rules');box.replaceChildren();box.hidden=!isDuel();
  if(isDuel())box.append(el('strong',null,'双人 · 演出或挖角（二选一）'),el('span','duel-rule-detail','每人每轮最多挖 3 次，每次只拿 1 张；挖角后立即换人。'));
}
function renderSeats(){
  $('seats').replaceChildren();state.players.filter(p=>p.id!==state.myPlayerId).forEach(p=>{
    const a=state.lastAction,phase=actionPhase(),showing=presentationLocked(),actor=showing&&a?.actorId===p.id;
    const seat=el('article',`player-seat${actor||!showing&&p.id===state.activePlayerId&&state.phase==='PLAYING'?' active':''}${actor?' presenting-actor':''}`);seat.id=`seat-${p.id}`;
    const status=p.isBot?`${levelName[p.difficulty]}电脑`:p.controlled?'电脑暂时代管':!p.connected?'离线 · 保留座位':'在线';
    const acting=actor?(phase==='scout'?'正在挖角 1 张':phase==='show'?'正在演出':phase==='curtain'?'最后一手 · 谢幕中':'行动展示中'):!showing&&state.phase==='PLAYING'&&p.id===state.activePlayerId?'行动中':status;
    seat.append(el('div','name',p.name),el('div','status',state.phase==='PREPARE'?p.isReady?'已准备':`${status} · 选方向中`:acting));
    let visibleCount=p.handCount;
    if(actor){if(phase==='scout'||phase==='show'&&a.kind==='show')visibleCount=a.handCountBefore;else if(phase==='show'&&a.kind==='scout_show')visibleCount=a.handCountBefore+1;}
    const stats=el('div','stats');for(const [label,value]of (isDuel()?[['手牌',visibleCount],['牌分',p.scorePileCount],['余次',scoutsLeft(p)],['总分',p.totalScore]]:[['手牌',visibleCount],['本轮',p.scorePileCount+p.scoutChips],['总分',p.totalScore]])){const s=el('span',null,label);s.append(el('b',null,value));stats.append(s);}seat.append(stats);$('seats').append(seat);
  });
}
function preview(){return draft&&draft.side&&draft.index!==null?R.previewScout(state.myHand,state.currentShow?.cards,{side:draft.side,flip:draft.flip,insertIndex:draft.index}):null;}
function renderStage(){
  const phase=actionPhase(),a=state.lastAction,showing=presentationLocked();
  const current=showing&&a?P.stageAt(a,serverNow()):state.currentShow,me=myPlayer();$('turn-banner').classList.toggle('my-turn',myTurn());
  $('turn-banner').textContent=state.phase==='PREPARE'?me.isReady?'你已准备，等待其他演员':'开场前 · 选择整手牌的方向':state.phase==='PLAYING'?myTurn()?isDuel()?`轮到你 · 本轮剩余 ${scoutsLeft()} 次挖角${scoutsLeft()===0?'，请演出':''}`:'聚光灯照向你 · 轮到你行动':`等待 ${state.players.find(p=>p.id===state.activePlayerId)?.name||'玩家'} 行动`:'本轮演出结束';
  if(!socket.connected&&!tutorial)$('turn-banner').textContent='连接中断，正在找回你的座位…';
  else if(showing&&a)$('turn-banner').textContent=phase==='curtain'?'最后一手已完成 · 先看清舞台，再结算':`全场观看 · ${a.actorName} 的行动`;
  const remaining=draft?.side?R.previewScout(state.myHand,current?.cards,{side:draft.side,flip:draft.flip,insertIndex:draft.index??0}):null;
  $('stage-title').textContent=remaining?.success?`挖角后预览 · ${remaining.combo?.label||'空舞台'}`:current?`${current.playerName} · ${current.combo.label}`:'聚光灯已就位';
  const box=$('stage-cards');box.replaceChildren();
  if(current)current.cards.forEach(c=>{const n=card(c);if(draft?.side&&(draft.side==='left'?current.cards[0]:current.cards.at(-1)).id===c.id)n.classList.add('scouted');if(showing&&phase==='scout'&&c.id===a.scoutedCard?.id)n.classList.add('scout-highlight');box.append(n);});
  else{const empty=el('div','stage-empty');empty.append(el('b',null,'✧'),el('span',null,'舞台空着 · 用任意合法组合开场'));box.append(empty);}
  const actions=$('stage-actions');actions.replaceChildren();
  if(draft?.step==='edge'&&current){actions.append(button(`← 左端 ${current.cards[0].top}`,'',()=>chooseEdge('left')),button(`右端 ${current.cards.at(-1).top} →`,'',()=>chooseEdge('right')));}
  renderPublicAction(a,phase);
}
function renderPublicAction(a,phase){
  const hud=$('action-hud'),summary=$('last-action-summary'),stage=hud.closest('.stage');
  const showing=!!a&&phase!=='done';stage.classList.toggle('is-presenting',showing);stage.classList.toggle('is-curtain',phase==='curtain');
  hud.hidden=!showing;summary.hidden=!a||showing;
  if(!a)return;
  const actionName={show:'演出',scout:'挖角',scout_show:'挖角并演出'}[a.kind];
  const key=`${a.id}:${phase}`;
  if(hud.dataset.key!==key){
    hud.dataset.key=key;hud.replaceChildren();
    let title,detail;
    if(phase==='curtain'){
      const outcome=a.outcome;
      title=outcome?.reason==='EMPTY_HAND'?`${outcome.playerName} 已出完手牌`:outcome?.reason==='BLOCKED'?`${outcome.playerName} 的对手已无法行动`:`${outcome?.playerName||a.actorName} 的演出无人压过`;
      detail='本轮结束 · 保留最后的舞台，随后显示得分明细';
    }else if(phase==='scout'){
      title=`${a.actorName} · ${a.kind==='scout_show'?'① 挖角':'挖角'} 1 张`;
      detail=`从${a.sourceSide==='left'?'左':'右'}端取走 1 张${a.ownerChipAward?` · ${a.sourceOwnerName} 获得 1 枚筹码`:` · 本轮还可挖角 ${a.remainingScouts} 次`}`;
    }else if(phase==='show'){
      title=`${a.actorName} · ${a.kind==='scout_show'?'② 演出':'演出'}`;
      detail=`${R.analyzeCombo(a.shownCards)?.label||'新的表演'}${a.capturedCount?` · 收下 ${a.capturedCount} 张得分牌`:''}`;
    }else{
      title=`${a.actorName} · ${actionName}完成`;
      detail=a.kind==='scout'?a.remainingScouts!==null?`手牌 +1 · 本轮还可挖角 ${a.remainingScouts} 次 · 本回合结束，下一位稍后行动`:`手牌 +1 · ${a.sourceOwnerName} 筹码 +1，下一位稍后行动`:a.kind==='scout_show'?`先挖 1 张，再打出 ${a.shownCards.length} 张 · 本轮特殊机会已使用`:`${R.analyzeCombo(a.shownCards)?.label||'演出成功'}${a.capturedCount?` · 得分牌 +${a.capturedCount}`:''}`;
    }
    hud.append(el('span','action-kicker',phase==='curtain'?'CURTAIN CALL / 谢幕':a.kind==='scout_show'?'SCOUT & SHOW / 分步展示':'TABLE ACTION / 全场可见'),el('strong','action-title',title),el('span','action-detail',detail));
    if(phase==='curtain')hud.append(el('span','curtain-countdown'));
  }
  const countdown=hud.querySelector('.curtain-countdown');if(countdown)countdown.textContent=`${Math.max(1,Math.ceil((a.settlementAt-serverNow())/1000))} 秒后显示结算`;
  summary.textContent=`刚刚：${a.actorName} ${actionName}${a.kind==='scout'?' 1 张':` · ${R.analyzeCombo(a.shownCards)?.label||''}`}${a.capturedCount?`，得分牌 +${a.capturedCount}`:''}`;
  if(showing&&(phase==='scout'||phase==='show'))animatePublicCards(a,phase);
}
function animatePublicCards(a,phase){
  const key=`${a.id}:${phase}`;if(animatedFlights.has(key))return;animatedFlights.add(key);if(animatedFlights.size>100){animatedFlights.clear();animatedFlights.add(key);}
  if(preferences.reduced)return;
  requestAnimationFrame(()=>{
    if(state?.lastAction?.id!==a.id||actionPhase()!==phase)return;
    const stage=$('stage-cards').getBoundingClientRect();
    const actor=(a.actorId===state.myPlayerId?$('hand-heading'):document.getElementById(`seat-${a.actorId}`))?.getBoundingClientRect();if(!actor)return;
    const origin=phase==='scout'?document.querySelector(`#stage-cards [data-card-id="${a.scoutedCard.id}"]`)?.getBoundingClientRect()||stage:actor;
    const target=phase==='scout'?actor:stage;
    const flight=el('div',`action-flight ${phase==='show'?'show-flight':''}`);flight.setAttribute('aria-hidden','true');
    const cards=phase==='scout'?[a.scoutedCard]:a.shownCards.slice(0,6);cards.forEach(c=>flight.append(card(c)));
    if(phase==='show'&&a.shownCards.length>6)flight.append(el('span','flight-extra',`+${a.shownCards.length-6}`));
    document.body.append(flight);
    const width=flight.getBoundingClientRect().width,height=flight.getBoundingClientRect().height;
    const fromX=origin.x+origin.width/2-width/2,fromY=origin.y+origin.height/2-height/2,toX=target.x+target.width/2-width/2,toY=target.y+target.height/2-height/2;
    const duration=Math.min(950,a.durationMs*(a.kind==='scout_show'?.29:.44));
    const animation=flight.animate([{transform:`translate(${fromX}px,${fromY}px) scale(.65)`,opacity:0},{transform:`translate(${fromX}px,${fromY-15}px) scale(1)`,opacity:1,offset:.22},{transform:`translate(${toX}px,${toY}px) scale(${phase==='scout'?'.6':'.9'})`,opacity:0}],{duration,easing:'ease-in-out',fill:'forwards'});
    if(phase==='scout')setTimeout(()=>flight.classList.add('card-back'),duration*.42);
    animation.onfinish=()=>flight.remove();setTimeout(()=>flight.remove(),duration+300);
  });
}
function renderHand(){
  const me=myPlayer();if(!me)return;const heading=$('hand-heading');heading.replaceChildren();const title=el('h3',null,'你的手牌');title.append(el('small',null,'顺序不可改变'));const stats=el('div','my-stats');
  for(const [label,value]of (isDuel()?[['得分牌',me.scorePileCount],['剩余挖角',`${scoutsLeft()} / 3`]]:[['得分牌',me.scorePileCount],['筹码',me.scoutChips],['挖角并演出',me.hasScoutAndShow?'可用':'已使用']])){const s=el('span',null,`${label} `);s.append(el('b',null,value));stats.append(s);}heading.append(title,stats);
  const flow=$('flow');flow.textContent='';
  if(tutorial)flow.textContent=tutorialInstructions[tutorial.step];
  if(draft){const stepText=draft.step==='edge'?'第一步 · 点击舞台左端或右端，选择要招募的演员':draft.step==='place'?'第二步 · 可翻转新牌，点击绿色 ＋ 选择插入位置，再确认':`第三步 · 在预览手牌中选相邻组合，压过挖角后的舞台${preview()?.combo?`（${preview().combo.label}）`:'（空舞台）'}`;flow.textContent=(tutorial?tutorialInstructions[tutorial.step]+'\n':'')+stepText;}
  const box=$('hand'),scroll=box.scrollLeft,focused=document.activeElement?.dataset?.handIndex;box.replaceChildren();const v=preview(),hand=v?.success?v.hand:state.myHand;
  if(draft?.step==='place'){
    // Slots refer to the original hand, never to a previously inserted preview.
    for(let i=0;i<=state.myHand.length;i++){
      const slot=button('+',`insert-slot${draft.index===i?' chosen':''}`,()=>{draft.index=i;renderHand();renderControls();});slot.setAttribute('aria-label',`插入位置 ${i+1}`);box.append(slot);
      if(draft.index===i&&v?.success){const n=card(v.card);n.classList.add('preview');box.append(n);}
      if(i<state.myHand.length)box.append(card(state.myHand[i],i));
    }
  }else hand.forEach((c,i)=>{const n=card(c,i,state.phase==='PLAYING'&&(!draft||draft.step==='show'));if(draft&&v?.success&&c.id===v.card.id)n.classList.add('preview');box.append(n);});
  box.scrollLeft=scroll;
  if(focused!==undefined)box.querySelector(`[data-hand-index="${focused}"]`)?.focus({preventScroll:true});
}
function renderControls(){
  const box=$('controls'),feedback=$('selection-feedback');box.replaceChildren();feedback.textContent='';const me=myPlayer();if(!me)return;
  if(state.phase==='PREPARE'){
    box.append(button('↻ 旋转整手牌','secondary',()=>command('flip_hand'),me.isReady||pending||!socket.connected&&!tutorial),button(me.isReady?'已准备 · 等待其他人':'确认方向，准备演出','primary',()=>command('ready'),me.isReady||pending||!socket.connected&&!tutorial));feedback.textContent='旋转会同时反转牌序和上下数字；准备后本轮不可再调整。';return;
  }
  if(state.phase!=='PLAYING')return;
  if(presentationLocked()){
    box.append(button('正在观看行动…','primary',()=>{},true));feedback.textContent='所有玩家看完这一手后，再继续行动。';return;
  }
  if(draft){
    if(draft.step==='place'){
      const c=state.currentShow.cards[draft.side==='left'?0:state.currentShow.cards.length-1];
      box.append(button(`↻ 新牌 ${draft.flip?c.bottom:c.top} / ${draft.flip?c.top:c.bottom}`,'secondary',()=>{draft.flip=!draft.flip;renderHand();renderControls();}),button(draft.mode==='combo'?'确认插入，继续选牌':isDuel()?'挖 1 张，花费 1 次并结束回合':'挖 1 张，结束回合','primary',()=>{
        if(draft.index===null)return;
        if(draft.mode==='combo'){draft.step='show';selected.clear();render();}
        else command('action_scout',{side:draft.side,flip:draft.flip,insertIndex:draft.index});
      },draft.index===null||!myTurn()));
    }else if(draft.step==='show')appendShowButton(true);
    box.append(button('取消此次操作','quiet',()=>{draft=null;selected.clear();render();}));
  }else{
    appendShowButton(false);
    box.append(button(isDuel()?`挖角（剩 ${scoutsLeft()} 次）`:'挖角（仅 1 张）','secondary',()=>startDraft('scout'),!myTurn()||!state.currentShow||isDuel()&&scoutsLeft()===0));
    if(!isDuel())box.append(button('挖角并演出 · 每轮1次','secondary',()=>startDraft('combo'),!myTurn()||!state.currentShow||!me.hasScoutAndShow));
    if(state.settings.allowHints)box.append(button('给我建议','quiet',getHint,!myTurn()));
  }
  if(selected.size)box.append(button('清除选择','quiet',()=>{selected.clear();renderHand();renderControls();}));
  if(pending)feedback.textContent='正在等待主机确认…';
  function appendShowButton(comboMode){
    const v=preview(),hand=comboMode?v.hand:state.myHand,stage=comboMode?v.combo:state.currentShow?.combo;
    const valid=R.selection(hand,[...selected],stage);
    if(selected.size)feedback.textContent=valid.success?`${valid.combo.label} · 可以${stage?'压制':'开场'}`:valid.msg;
    else feedback.textContent=myTurn()?isDuel()?scoutsLeft()>0?'演出或挖角二选一。每挖 1 张花费 1 次，挖角后立即轮到对手，不能接着挖角或演出。':'本轮挖角次数已用完，只能演出。':'普通挖角拿 1 张后结束回合；挖角并演出需要消耗本轮一次的特殊机会。':state.lastAction?.kind==='scout'&&state.lastAction.actorId===state.myPlayerId?'你已挖角 1 张，本回合已结束。请等待对手行动。':'可以查看规则，等待轮到自己。';
    box.append(button(comboMode?'确认挖角并演出':valid.success?`演出 · ${valid.cards.length} 张`:'演出','primary',()=>comboMode?command('action_scout_and_show',{scoutData:{side:draft.side,flip:draft.flip,insertIndex:draft.index},showIndices:[...selected]}):command('action_show',{selectedIndices:[...selected]}),!myTurn()||!valid.success));
  }
}
function startDraft(mode){if(!myTurn())return;if(mode==='combo'&&isDuel())return toast('双人局只能选择演出或挖角');draft={mode,step:'edge',side:null,flip:false,index:null};selected.clear();render();}
function chooseEdge(side){if(!draft||!myTurn())return;draft.side=side;draft.step='place';render();}
async function getHint(){
  if(tutorial)return toast('教学中，请跟随绿色文字尝试行动。');
  const res=await request('request_hint');if(!res.success)return toast(res.msg);
  if(res.event==='action_show'){draft=null;selected=new Set(res.data.selectedIndices);}
  else{const data=res.event==='action_scout'?res.data:res.data.scoutData;draft={mode:res.event==='action_scout'?'scout':'combo',step:res.event==='action_scout'?'place':'show',side:data.side,flip:data.flip,index:data.insertIndex};selected=new Set(res.data.showIndices||[]);}
  render();toast(`${res.label}。${res.msg}`);
}
function renderLogs(){const box=$('activity-list');box.replaceChildren();state.logs.forEach(text=>box.append(el('li',null,text)));}
function renderResult(){
  if(!['ROUND_OVER','GAME_OVER'].includes(state.phase)){resultKey='';$('result-dialog').close();return;}
  if(presentationLocked()){$('result-dialog').close();return;}
  const result=state.lastRoundResult;if(!result)return;
  const box=$('result-content');box.replaceChildren();box.append(el('h2',null,state.phase==='GAME_OVER'?'掌声，献给每一位演员。':`第 ${state.round} 轮 · 谢幕`));
  box.append(el('p','result-caption',`${result.triggerPlayerName} ${result.triggerType==='EMPTY_HAND'?'率先出完手牌':result.triggerType==='BLOCKED'?'的对手无法继续行动':'的演出无人压过'}。`));
  if(state.phase==='GAME_OVER'){
    const best=Math.max(...state.players.map(p=>p.totalScore)),winners=state.players.filter(p=>p.totalScore===best);
    box.append(el('div','winner-banner',`${winners.length>1?'共同获胜':'本场最佳'} · ${winners.map(p=>p.name).join('、')} / ${best} 分`));
    const rank=[...state.players].sort((a,b)=>b.totalScore-a.totalScore);box.append(scoreTable(['名次','演员','总分'],rank.map(p=>[`${1+rank.filter(q=>q.totalScore>p.totalScore).length}`,p.name,`${p.totalScore}`])));
  }
  box.append(el('h3',null,'本轮每一分，都算清楚'),scoreTable(['演员','得分牌',isDuel()?'未用筹码':'筹码','手牌扣分','本轮','总分'],result.scores.map(s=>[s.name,`+${s.showPoints}`,`+${s.chipPoints}`,s.isExempt?'0 · 豁免':s.handPenalty?`−${s.handPenalty}`:'0',`${s.netScore>0?'+':''}${s.netScore}`,`${s.totalScore}`])));
  if(state.history.length>1){box.append(el('h3','history-table','逐轮成绩'),scoreTable(['轮次',...state.players.map(p=>p.name)],state.history.map(r=>[`${r.round}`,...state.players.map(p=>`${r.scores.find(s=>s.id===p.id)?.netScore??'—'}`)])));}
  const actions=el('div','result-buttons');
  if(tutorial)actions.append(button('完成教学，去练习 →','primary',()=>{exitTutorial();enter(true);}));
  else if(host())actions.append(button(state.phase==='GAME_OVER'?'再来一局':'下一轮 →','primary',()=>command(state.phase==='GAME_OVER'?'restart_game':'next_round'),pending),button('回大厅调整席位','secondary',()=>command('return_lobby'),pending));
  else actions.append(el('p','muted','等待房主继续，或关闭结算查看牌桌。'));
  box.append(actions);
  const key=`${tutorial?'tutorial':state.roomId}:${state.round}:${state.phase}`;
  if(resultKey!==key){resultKey=key;showDialog('result-dialog');Sound.play('win');}
}
function scoreTable(head,rows){const wrap=el('div','score-scroll'),table=el('table','scores'),thead=el('thead'),tr=el('tr');head.forEach(h=>tr.append(el('th',null,h)));thead.append(tr);table.append(thead);const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach((cell,i)=>tr.append(el('td',i>=row.length-2&&String(cell).startsWith('-')?'negative':i>=row.length-2?'positive':'',cell)));body.append(tr);});table.append(body);wrap.append(table);return wrap;}
async function openShare(){
  const box=$('share-content');box.replaceChildren(el('p','muted','正在读取本机网络地址…'));showDialog('share-dialog');
  const loopback=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
  $('share-intro').textContent=loopback?'好友连接同一 Wi-Fi，在浏览器输入下面的局域网链接。':'把房间链接发给好友，打开网页并输入昵称即可加入。';
  $('share-network-hint').hidden=!loopback;
  let addresses;
  if(!loopback)addresses=[{name:'当前房间地址',url:location.origin}];
  else{
    try{network=await (await fetch('/api/network')).json();}catch{box.replaceChildren(el('p',null,'暂时无法读取网络地址，请查看主机启动窗口。'));return;}
    addresses=network.addresses.filter(a=>a.private&&!a.virtual);if(!addresses.length)addresses.push(...network.addresses);
  }
  box.replaceChildren();
  if(!addresses.length)box.append(el('p',null,'还没有找到局域网地址，请先连接 Wi-Fi 或网线。'));
  for(const a of addresses){const row=el('div','invite-row'),input=el('input');input.value=`${a.url}/?room=${state.roomId}`;input.readOnly=true;input.setAttribute('aria-label',`${a.name} 邀请链接`);row.append(el('label',null,`${a.name}${a.virtual?' · 虚拟网卡':''}`),input,button('复制邀请链接','secondary',async()=>{
    try{if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(input.value);toast('邀请链接已复制');}catch{input.focus();input.select();toast('请长按或使用 Ctrl+C 复制选中的链接');}
  }));box.append(row);}
  box.append(el('p',null,`房间号：${state.roomId}`));
}
$('leave-confirm').addEventListener('click',async()=>{
  const res=await request('leave_room');if(!res.success)return toast(res.msg);
  state=null;session=null;selected.clear();draft=null;resultKey='';try{sessionStorage.removeItem('scout-session');}catch{}history.replaceState(null,'','/');$('leave-dialog').close();render();
});
// Tutorial uses fixed cards and the same rules module; it never sends game actions to a live room.
const tutorialInstructions=[
  '① 方向：试着旋转整手牌，观察数字和牌序一起反转；再点“确认方向”。',
  '② 演出：选择第 1、2 张的 3 和 4，组成相邻顺子，压过舞台上的单张 2。',
  '③ 挖角：招募舞台的 5，不翻面，插在 4 与 6 之间，确认后连成 4、5、6。',
  '④ 挖角并演出：取舞台的 3，插到 4 前面；选出 3、4、5、6，完成演出。',
  '⑤ 计分：点选两张 8 演出。旧舞台牌记分，剩余手牌扣分，出完则立即结算。'
];
const c=(id,top,bottom)=>({id,top,bottom});
function tutorialState(step){
  const hands=[[c(1,3,7),c(2,4,8),c(3,9,2),c(4,5,6)],[c(1,3,7),c(2,4,8),c(3,9,2),c(4,5,6)],[c(10,4,8),c(11,6,9),c(12,8,1)],[c(10,4,8),c(13,5,2),c(11,6,9),c(12,8,1)],[c(20,8,3),c(21,8,5)]];
  const stages=[null,[c(30,2,7)],[c(31,5,9),c(32,5,7)],[c(33,3,8),c(34,3,9)],[c(35,7,2),c(36,7,5)]];
  const cards=stages[step],me={id:'you',name:'你',connected:true,isReady:false,isBot:false,handCount:hands[step].length,scorePileCount:step===4?3:0,scoutChips:step===4?1:0,hasScoutAndShow:true,totalScore:0,roundScore:0},bot={...me,id:'coach',name:'露露 · 教学搭档',isBot:true,difficulty:'easy',isReady:true,handCount:5};
  return {roomId:'学习',phase:step===0?'PREPARE':'PLAYING',round:1,maxRounds:1,version:step,myPlayerId:'you',hostId:'you',activePlayerId:'you',settings:{allowHints:false},players:[me,bot,{...bot,id:'coach2',name:'阿奇 · 教学搭档'}],myHand:hands[step],currentShow:cards?{cards,combo:R.analyzeCombo(cards),playerId:'coach',playerName:bot.name}:null,logs:['教学使用固定手牌，可以安心尝试。'],history:[],lastRoundResult:null};
}
$('tutorial-start').addEventListener('click',()=>{tutorial={step:0};resultKey='';draft=null;selected.clear();state=tutorialState(0);render();});
function nextTutorial(){tutorial.step++;draft=null;selected.clear();state=tutorialState(tutorial.step);Sound.play('show');render();}
function tutorialCommand(event,data){
  const step=tutorial.step;
  if(event==='flip_hand'){state.myHand=R.rotateHand(state.myHand);render();return;}
  if(event==='ready'&&step===0){nextTutorial();return;}
  if(event==='action_show'&&(step===1||step===4)){
    const v=R.selection(state.myHand,data.selectedIndices,state.currentShow.combo);if(!v.success)return toast(v.msg);
    if(v.cards.length!==2)return toast('这一步试试选中相邻的两张牌。');
    if(step===1){nextTutorial();return;}
    state.phase='GAME_OVER';state.players[0].totalScore=6;state.players[0].handCount=0;state.players[0].scorePileCount=5;state.players[1].totalScore=-4;state.players[2].totalScore=-3;state.currentShow={cards:state.myHand,combo:R.analyzeCombo(state.myHand),playerId:'you',playerName:'你'};state.myHand=[];
    state.lastRoundResult={round:1,triggerType:'EMPTY_HAND',triggerPlayerName:'你',scores:[{id:'you',name:'你',showPoints:5,chipPoints:1,handPenalty:0,isExempt:false,netScore:6,totalScore:6},{id:'coach',name:'露露',showPoints:1,chipPoints:0,handPenalty:5,isExempt:false,netScore:-4,totalScore:-4},{id:'coach2',name:'阿奇',showPoints:2,chipPoints:0,handPenalty:5,isExempt:false,netScore:-3,totalScore:-3}]};state.history=[state.lastRoundResult];selected.clear();render();return;
  }
  if(event==='action_scout'&&step===2){const v=R.previewScout(state.myHand,state.currentShow.cards,data);if(!v.success)return toast(v.msg);if(v.hand.slice(0,3).map(c=>c.top).join(',')!=='4,5,6')return toast('把数字 5 放到 4 和 6 之间，不需要翻面。');nextTutorial();return;}
  if(event==='action_scout_and_show'&&step===3){const p=R.previewScout(state.myHand,state.currentShow.cards,data.scoutData);const v=p.success&&R.selection(p.hand,data.showIndices,p.combo);if(!v?.success)return toast(v?.msg||p.msg);if(v.cards.length!==4)return toast('试着把招募的 3 放在 4 前面，选出完整的 3、4、5、6。');nextTutorial();return;}
  toast('请跟随手牌上方的绿色教学提示完成这一步。');
}
function exitTutorial(){tutorial=null;state=null;draft=null;selected.clear();resultKey='';$('result-dialog').close();render();}
render();
})();

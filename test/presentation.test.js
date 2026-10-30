'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Game=require('../game/scoutGame'),R=require('../public/rules'),P=require('../public/presentation');
const {createScoutServer}=require('../server'),{io}=require('../node_modules/socket.io/client-dist/socket.io');
const c=(id,top,bottom=2)=>({id,top,bottom});
function fixture(){const g=new Game('CAST');for(let i=0;i<3;i++)g.addPlayer(`p${i}`,`演员${i}`);g.phase='PLAYING';g.round=1;g.maxRounds=3;g.players.forEach((p,i)=>p.hand=[c(20+i*3,8),c(21+i*3,8),c(22+i*3,3)]);g.currentShow={playerId:'p2',playerName:'演员2',cards:[c(1,7,1),c(2,7,4)],combo:R.analyzeCombo([c(1,7,1),c(2,7,4)])};return g;}
test('公开挖角记录保留原舞台朝向，绝不包含私有插入位置与新手牌；失败不产生展示',()=>{
  const g=fixture(),before=JSON.stringify(g);assert.equal(g.playScout('p0','left',true,999).success,false);assert.equal(JSON.stringify(g),before);
  assert.ok(g.playScout('p0','left',true,1).success);const a=g.lastAction;
  assert.equal(a.scoutedCard.top,7);assert.equal(g.players[0].hand[1].top,1);assert.equal(a.sourceSide,'left');assert.equal(a.afterStage.cards.length,1);
  assert.equal(a.handCountBefore,3);assert.equal(a.handCountAfter,4);assert.equal(a.ownerChipAward,1);
  assert.deepEqual(g.getClientState('p1').lastAction,a);assert.ok(!Object.keys(a).some(k=>/insert|flip|hand$/i.test(k)));
  assert.ok(!g.getClientState('p1').players.some(p=>'hand' in p));
});
test('挖角并演出分为取牌、剩余舞台、完成三阶段，时间边界与晚到客户端一致',()=>{
  const g=fixture();assert.ok(g.playScoutAndShow('p0',{side:'right',flip:true,insertIndex:3},[0,1]).success);const a=g.lastAction,t=a.startedAt;
  assert.equal(P.phaseAt(a,t),'scout');assert.deepEqual(P.stageAt(a,t).cards.map(c=>c.id),[1,2]);
  assert.equal(P.phaseAt(a,t+1360),'show');assert.deepEqual(P.stageAt(a,t+1360).cards.map(c=>c.id),[1]);
  assert.equal(P.phaseAt(a,t+2720),'landed');assert.deepEqual(P.stageAt(a,t+2720).cards.map(c=>c.id),[20,21]);
  assert.equal(P.phaseAt(a,a.until),'done');assert.deepEqual(P.milestones(a),[t+1360,t+2720,a.until]);
  const restored=Game.restore(JSON.parse(JSON.stringify(g)));assert.deepEqual(restored.lastAction,a);assert.equal(P.phaseAt(restored.lastAction,t+2000),'show');
});
test('最后一手先展示，再谢幕，最后才允许结算；挖角触发结束也遵守同一时间线',()=>{
  for(const kind of ['show','scout','scout_show']){
    const g=fixture();if(kind==='show'){g.players[0].hand=[c(99,9)];g.currentShow.cards=[c(1,7)];g.currentShow.combo=R.analyzeCombo(g.currentShow.cards);assert.ok(g.playShow('p0',[0]).success);}
    else if(kind==='scout'){g.consecutiveScouts=1;assert.ok(g.playScout('p0','left',false,0).success);}
    else{g.players[0].hand=[c(99,8)];assert.ok(g.playScoutAndShow('p0',{side:'left',flip:false,insertIndex:0},[0,1]).success);}
    const a=g.lastAction;assert.equal(a.roundEnded,true);assert.equal(P.phaseAt(a,a.until-1),'landed');assert.equal(P.phaseAt(a,a.until),'curtain');assert.equal(P.phaseAt(a,a.settlementAt-1),'curtain');assert.equal(P.phaseAt(a,a.settlementAt),'done');assert.equal(a.settlementAt-a.until,2800);
    assert.equal(a.outcome.reason,kind==='scout'?'LOOP':'EMPTY_HAND');assert.equal(a.outcome.playerId,kind==='scout'?'p2':'p0');
  }
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function client(port){const s=io(`http://127.0.0.1:${port}`,{transports:['websocket'],reconnection:false,forceNew:true});s.on('game_state_update',v=>s.state=v);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);});return s;}
function send(s,event,data={}){return new Promise((r,j)=>s.timeout(3000).emit(event,data,(e,v)=>e?j(e):r(v)));}
let seq=0;function act(s,event,data={}){return send(s,event,{version:s.state.version,actionId:`presentation-test-${++seq}`,...data});}
test('真实多端：展示锁、重复确认、重连不重放、AI等展示结束再思考、最终结算锁',async()=>{
  let now=Date.now();const service=createScoutServer({dbPath:':memory:',clock:()=>now,tickMs:100000,aiDelayMs:1600}),sockets=[];
  try{
    const port=await service.listen(0),a=await client(port),b=await client(port);sockets.push(a,b);
    const joined=await send(a,'create_room',{playerName:'房主'});assert.ok(joined.success);assert.ok((await send(b,'join_room',{roomId:joined.roomId,playerName:'好友'})).success);await sleep(20);
    assert.ok((await act(a,'add_bot')).success);await sleep(20);assert.ok((await act(a,'start_game')).success);await sleep(20);
    const r=service.rooms.get(joined.roomId),g=r.game;g.phase='PLAYING';g.round=1;g.activePlayerIndex=0;
    const [pa,pb,bot]=g.players;pa.hand=[c(20,8),c(21,8),c(22,3)];pb.hand=[c(30,9),c(31,1)];bot.hand=[c(40,10),c(41,1)];
    g.currentShow={cards:[c(1,7),c(2,7)],combo:R.analyzeCombo([c(1,7),c(2,7)]),playerId:bot.id,playerName:bot.name};g.version++;
    const sync=()=>{for(const s of sockets)if(s.connected)service.io.to(s.id).emit('game_state_update',g.getClientState(s.state.myPlayerId));};sync();await sleep(20);
    const request={version:a.state.version,actionId:'public-scout-unique',side:'left',flip:true,insertIndex:1};assert.ok((await send(a,'action_scout',request)).success);await sleep(20);
    const id=g.lastAction.id,deadline=g.presentationUntil;assert.equal(deadline-now,2600);assert.deepEqual(a.state.lastAction,b.state.lastAction);assert.equal(b.state.myHand.length,2);
    const snapshot=JSON.stringify(g);assert.equal((await act(b,'action_show',{selectedIndices:[0]})).code,'PRESENTATION_BUSY');assert.equal(JSON.stringify(g),snapshot);
    assert.ok((await send(a,'action_scout',request)).duplicate);assert.equal(g.lastAction.id,id);assert.equal(g.presentationUntil,deadline);
    a.disconnect();const resumed=await client(port);sockets.push(resumed);assert.ok((await send(resumed,'room_rejoin',{roomId:joined.roomId,token:joined.token})).success);await sleep(20);assert.equal(resumed.state.lastAction.id,id);assert.equal(resumed.state.presentationUntil,deadline);
    now=deadline;assert.ok((await act(b,'action_show',{selectedIndices:[0]})).success);await sleep(20);
    const beforeAI=g.lastAction.id;service.tick();now=g.presentationUntil-1;service.tick();assert.equal(g.lastAction.id,beforeAI);assert.equal(r.botDue,null);
    now++;service.tick();assert.equal(r.botDue.at,now+1600);now+=1599;service.tick();assert.equal(g.lastAction.id,beforeAI);now++;service.tick();assert.notEqual(g.lastAction.id,beforeAI);
    // Install a final public position, then use the normal host request path.
    for(const round of [1,g.maxRounds]){
      now=g.presentationUntil;g.phase='PLAYING';g.round=round;g.activePlayerIndex=0;g.lastAction=null;g.presentationUntil=0;pa.hand=[c(80,10)];g.currentShow={cards:[c(81,1)],combo:R.analyzeCombo([c(81,1)]),playerId:pb.id,playerName:pb.name};g.version++;sync();await sleep(20);
      assert.ok((await act(resumed,'action_show',{selectedIndices:[0]})).success);await sleep(20);assert.equal(g.phase,round===g.maxRounds?'GAME_OVER':'ROUND_OVER');assert.equal(g.presentationUntil-now,4800);
      now=g.lastAction.until+1000;for(const event of ['start_game','next_round','restart_game','return_lobby'])assert.equal((await act(resumed,event)).code,'PRESENTATION_BUSY');
      now=g.settlementAt;assert.ok((await act(resumed,round===g.maxRounds?'restart_game':'next_round')).success);assert.equal(g.phase,'PREPARE');assert.equal(g.lastAction,null);assert.equal(g.presentationUntil,0);
    }
  }finally{for(const s of sockets)s.disconnect();await service.close();}
});

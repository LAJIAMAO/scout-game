'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {io}=require('../node_modules/socket.io/client-dist/socket.io');const {createScoutServer}=require('../server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function client(port){const s=io(`http://127.0.0.1:${port}`,{transports:['websocket'],reconnection:false,forceNew:true});s.on('game_state_update',v=>s.state=v);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
function send(s,event,data={}){return new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,res)=>err?reject(err):resolve(res)));}
let index=0;function act(s,event,data={}){return send(s,event,{...data,version:s.state.version,actionId:`network-action-${++index}`});}
async function settle(){await sleep(30);}
test('双人真实双端：挖角一次立即换人，原玩家连续操作拒绝，刷新不取回回合，三次预算跨回合累计',async()=>{
  const service=createScoutServer({dbPath:':memory:',tickMs:100000,presentationScale:0}),sockets=[];
  try{
    const port=await service.listen(0);let a=await client(port);const b=await client(port);sockets.push(a,b);
    const room=await send(a,'create_room',{playerName:'双人A'});assert.ok(room.success);assert.ok((await send(b,'join_room',{roomId:room.roomId,playerName:'双人B'})).success);await settle();
    assert.ok((await act(a,'start_game')).success);await settle();assert.ok((await act(a,'ready')).success);await settle();assert.ok((await act(b,'ready')).success);await settle();
    const g=service.rooms.get(room.roomId).game;g.activePlayerIndex=0;g.players[0].hand=[{id:20,top:1,bottom:2}];g.players[1].hand=[21,22,23,24].map(id=>({id,top:9,bottom:1}));g.players[1].hand.push({id:25,top:1,bottom:3});
    const cards=Array.from({length:8},(_,i)=>({id:i+1,top:7,bottom:2}));g.currentShow={cards,combo:require('../public/rules').analyzeCombo(cards),playerId:g.players[1].id,playerName:'双人B'};g.version++;
    for(const s of sockets)service.io.to(s.id).emit('game_state_update',g.getClientState(s.state.myPlayerId));await settle();
    assert.equal(a.state.rules.scoutEndsTurn,true);assert.equal(a.state.rules.allowScoutAndShow,false);assert.equal(a.state.players[0].hasScoutAndShow,false);
    for(let i=0;i<3;i++)for(let actor=0;actor<2;actor++){
      let current=actor===0?a:b;const next=actor===0?b:a;
      const data={actionId:`duel-scout-${i}-${actor}`,version:current.state.version,side:'left',flip:false,insertIndex:current.state.myHand.length};
      const res=await send(current,'action_scout',data);assert.ok(res.success);assert.equal(res.taken,1);assert.equal(res.remainingScouts,2-i);assert.equal(res.turnEnded,true);await settle();
      for(const s of [a,b]){assert.equal(s.state.activePlayerId,next.state.myPlayerId);assert.equal(s.state.players[actor].scoutsRemaining,2-i);assert.equal(s.state.lastAction.nextPlayerId,next.state.myPlayerId);}
      const before=JSON.stringify(g);for(const [event,payload] of [['action_scout',{side:'left',flip:false,insertIndex:0}],['action_show',{selectedIndices:[0]}],['action_scout_and_show',{scoutData:{side:'left',flip:false,insertIndex:0},showIndices:[0]}]])assert.equal((await act(current,event,payload)).success,false);assert.equal(JSON.stringify(g),before);
      assert.ok((await send(current,'action_scout',data)).duplicate);await settle();assert.equal(JSON.stringify(g),before);
      if(i===0&&actor===0){a.disconnect();a=await client(port);sockets.push(a);assert.ok((await send(a,'room_rejoin',{roomId:room.roomId,token:room.token})).success);await settle();assert.equal(a.state.activePlayerId,b.state.myPlayerId);assert.equal(a.state.myHand.length,2);assert.equal((await act(a,'action_scout',{side:'left',flip:false,insertIndex:0})).success,false);}
    }
    const before=JSON.stringify(g);assert.equal((await act(a,'action_scout',{side:'left',flip:false,insertIndex:0})).success,false);assert.equal(JSON.stringify(g),before);
    assert.ok((await act(a,'action_show',{selectedIndices:[1,2,3]})).success);await settle();assert.equal(b.state.activePlayerId,b.state.myPlayerId);assert.equal(a.state.players[0].scoutsRemaining,0);
  }finally{for(const s of sockets)s.disconnect();await service.close();}
});

test('双人 AI 挖角后只换人一次：展示结束后不会再自行挖角或演出',async()=>{
  let now=Date.now();const service=createScoutServer({dbPath:':memory:',tickMs:100000,clock:()=>now,aiDelayMs:1600}),sockets=[];
  try{
    const port=await service.listen(0),a=await client(port);sockets.push(a);const room=await send(a,'create_room',{playerName:'真人'});await settle();assert.ok((await act(a,'add_bot')).success);await settle();assert.ok((await act(a,'start_game')).success);await settle();
    const g=service.rooms.get(room.roomId).game,[human,bot]=g.players;g.phase='PLAYING';g.activePlayerIndex=1;human.hand=[1,2,3,4].map(id=>({id,top:3,bottom:1}));bot.hand=[{id:5,top:1,bottom:2},{id:6,top:2,bottom:1}];
    const cards=[7,8,9].map(id=>({id,top:9,bottom:5}));g.currentShow={cards,combo:require('../public/rules').analyzeCombo(cards),playerId:human.id,playerName:human.name};
    service.tick();now+=1600;service.tick();await settle();assert.equal(g.lastAction.kind,'scout');assert.equal(g.activePlayerIndex,0);assert.equal(bot.scoutChips,2);const id=g.lastAction.id;
    assert.equal((await act(a,'action_show',{selectedIndices:[0,1,2,3]})).code,'PRESENTATION_BUSY');
    now=g.presentationUntil+10000;service.tick();service.tick();await settle();assert.equal(g.lastAction.id,id);assert.equal(bot.scoutChips,2);assert.equal(a.state.activePlayerId,human.id);
    assert.ok((await act(a,'action_show',{selectedIndices:[0,1,2,3]})).success);
  }finally{for(const s of sockets)s.disconnect();await service.close();}
});

test('真实 Socket.IO 多客户端：组房、权限、重放、旧版本、恢复、托管、转交、退出与磁盘恢复',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scout-network-')),dbPath=path.join(dir,'test.sqlite'),sockets=[];
  let service=createScoutServer({dbPath,disconnectMs:25,aiDelayMs:0,tickMs:100000,presentationScale:0});
  let a,b,resume,c;
  try{
    let port=await service.listen(0,'0.0.0.0');a=await client(port);b=await client(port);sockets.push(a,b);
    const created=await send(a,'create_room',{playerName:'团长 <测试>'});assert.ok(created.success);assert.equal(created.roomId.length,4);
    const joined=await send(b,'join_room',{roomId:created.roomId,playerName:'好友'});assert.ok(joined.success);await settle();
    assert.equal(a.state.players.length,2);assert.equal(a.state.myPlayerId,created.playerId);assert.equal(a.state.hostId,created.playerId);
    assert.equal(JSON.stringify(a.state).includes('tokenHash'),false);assert.equal(JSON.stringify(a.state).includes(created.token),false);
    assert.equal((await act(b,'add_bot')).success,false);
    const data={version:a.state.version,actionId:'repeat-request-001',difficulty:'hard'};
    assert.ok((await send(a,'add_bot',data)).success);await settle();const v=a.state.version;
    const repeat=await send(a,'add_bot',data);assert.ok(repeat.duplicate);assert.equal(a.state.players.length,3);assert.equal(a.state.version,v);
    assert.equal((await send(a,'add_bot',{actionId:'stale-request-001',version:v-1})).stale,true);
    assert.equal((await send(a,'action_show',null)).success,false);
    assert.ok((await act(a,'start_game')).success);await settle();
    assert.equal(a.state.phase,'PREPARE');assert.equal(a.state.myHand.length,12);assert.equal(a.state.players[1].hand,undefined);
    const handBefore=a.state.myHand;
    a.disconnect();await settle();resume=await client(port);sockets.push(resume);
    assert.ok((await send(resume,'room_rejoin',{roomId:created.roomId,token:created.token})).success);await settle();
    assert.equal(resume.state.myPlayerId,created.playerId);assert.deepEqual(resume.state.myHand,handBefore);
    assert.equal((await send(resume,'room_rejoin',{roomId:created.roomId,token:'x'.repeat(64)})).success,false);
    resume.disconnect();await sleep(40);service.tick();await settle();
    assert.equal(b.state.hostId,joined.playerId);assert.equal(b.state.players.find(p=>p.id===created.playerId).controlled,true);
    c=await client(port);sockets.push(c);assert.ok((await send(c,'room_rejoin',{roomId:created.roomId,token:created.token})).success);await settle();assert.equal(c.state.players.find(p=>p.id===created.playerId).controlled,false);
    assert.ok((await act(c,'ready')).success);await settle();assert.ok((await act(b,'ready')).success);service.tick();service.tick();await settle();
    assert.equal(b.state.phase,'PLAYING');
    const game=service.rooms.get(created.roomId).game;const AI=require('../game/ai');
    for(let steps=0;game.phase==='PLAYING'&&steps<300;steps++){
      const p=game.players[game.activePlayerIndex];const move=AI.choose(game.getClientState(p.id),'normal');assert.ok(move);
      if(move.event==='action_show')game.playShow(p.id,move.data.selectedIndices);else if(move.event==='action_scout')game.playScout(p.id,move.data.side,move.data.flip,move.data.insertIndex);else game.playScoutAndShow(p.id,move.data.scoutData,move.data.showIndices);
    }
    assert.equal(game.phase,'ROUND_OVER');const history=structuredClone(game.history),beforeRestart=structuredClone(game.getClientState(created.playerId));
    await service.close();sockets.forEach(s=>s.disconnect());
    service=createScoutServer({dbPath,disconnectMs:25,aiDelayMs:0,tickMs:100000,presentationScale:0});port=await service.listen(0);
    const restored=service.rooms.get(created.roomId).game;assert.deepEqual(restored.history,history);assert.deepEqual(restored.getClientState(created.playerId).myHand,beforeRestart.myHand);
    const second=await client(port);sockets.push(second);assert.ok((await send(second,'room_rejoin',{roomId:created.roomId,token:created.token})).success);await settle();
    assert.equal(second.state.myPlayerId,created.playerId);assert.deepEqual(second.state.history,history);
    // No online human means automation stays paused.
    second.disconnect();await settle();const snapshot=JSON.stringify(restored);service.tick();service.tick();assert.equal(JSON.stringify(restored),snapshot);
    const network=await (await fetch(`http://127.0.0.1:${port}/api/network`)).json();assert.equal(network.port,port);assert.ok(Array.isArray(network.addresses));
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
    const attacker=await client(port);sockets.push(attacker);const bad=await send(attacker,'room_rejoin',{roomId:created.roomId,token:'x'.repeat(64)});assert.equal(bad.success,false);
    const host=await client(port);sockets.push(host);assert.ok((await send(host,'room_rejoin',{roomId:created.roomId,token:joined.token})).success);await settle();
    assert.ok((await send(host,'leave_room')).success);await settle();assert.equal(restored.players.find(p=>p.id===joined.playerId).left,true);
    assert.equal((await send(attacker,'room_rejoin',{roomId:created.roomId,token:joined.token})).success,false);
  }finally{for(const s of sockets)s.disconnect();await service.close();const resolved=path.resolve(dir),parent=path.resolve(os.tmpdir());if(!resolved.startsWith(parent+path.sep)||!path.basename(resolved).startsWith('scout-network-'))throw new Error('拒绝清理非测试目录');fs.rmSync(resolved,{recursive:true,force:true});}
});

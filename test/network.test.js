'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {io}=require('../node_modules/socket.io/client-dist/socket.io');const {createScoutServer}=require('../server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function client(port){const s=io(`http://127.0.0.1:${port}`,{transports:['websocket'],reconnection:false,forceNew:true});s.on('game_state_update',v=>s.state=v);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
function send(s,event,data={}){return new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,res)=>err?reject(err):resolve(res)));}
let index=0;function act(s,event,data={}){return send(s,event,{...data,version:s.state.version,actionId:`network-action-${++index}`});}
async function settle(){await sleep(30);}
test('双人真实双端请求：隐藏特殊行动、三次预算、重复请求不多拿、第四次与特殊行动均由服务端拒绝',async()=>{
  const service=createScoutServer({dbPath:':memory:',tickMs:100000}),sockets=[];
  try{
    const port=await service.listen(0),a=await client(port),b=await client(port);sockets.push(a,b);
    const room=await send(a,'create_room',{playerName:'双人A'});assert.ok(room.success);assert.ok((await send(b,'join_room',{roomId:room.roomId,playerName:'双人B'})).success);await settle();
    assert.ok((await act(a,'start_game')).success);await settle();assert.ok((await act(a,'ready')).success);await settle();assert.ok((await act(b,'ready')).success);await settle();
    const g=service.rooms.get(room.roomId).game;g.activePlayerIndex=0;g.players[0].hand=[{id:20,top:1,bottom:2}];g.players[1].hand=[{id:21,top:1,bottom:3}];
    const cards=[1,2,3,4].map((id,i)=>({id,top:7,bottom:i+2}));g.currentShow={cards,combo:require('../public/rules').analyzeCombo(cards),playerId:g.players[1].id,playerName:'双人B'};g.version++;
    for(const s of sockets)service.io.to(s.id).emit('game_state_update',g.getClientState(s.state.myPlayerId));await settle();
    assert.equal(a.state.rules.allowScoutAndShow,false);assert.equal(a.state.players[0].hasScoutAndShow,false);assert.equal(a.state.players[0].scoutsRemaining,3);
    const initial=JSON.stringify(g);assert.equal((await act(a,'action_scout_and_show',{scoutData:{side:'left',flip:false,insertIndex:1},showIndices:[1]})).success,false);assert.equal(JSON.stringify(g),initial);
    for(let i=0;i<3;i++){
      const data={actionId:`duel-scout-${i}`,version:a.state.version,side:'left',flip:false,insertIndex:a.state.myHand.length};
      const res=await send(a,'action_scout',data);assert.ok(res.success);assert.equal(res.taken,1);assert.equal(res.remainingScouts,2-i);assert.equal(res.turnEnded,false);await settle();
      assert.equal(a.state.activePlayerId,a.state.myPlayerId);assert.equal(a.state.players[0].scoutsRemaining,2-i);assert.equal(b.state.players[0].scoutsRemaining,2-i);assert.equal(a.state.players[1].scoutsRemaining,3);
      const count=a.state.myHand.length;assert.ok((await send(a,'action_scout',data)).duplicate);await settle();assert.equal(a.state.myHand.length,count);
    }
    const before=JSON.stringify(g);const fourth=await act(a,'action_scout',{side:'left',flip:false,insertIndex:0});assert.equal(fourth.success,false);assert.equal(JSON.stringify(g),before);
    assert.ok((await act(a,'action_show',{selectedIndices:[1,2,3]})).success);await settle();assert.equal(b.state.activePlayerId,b.state.myPlayerId);assert.equal(a.state.players[0].scoutsRemaining,0);
  }finally{for(const s of sockets)s.disconnect();await service.close();}
});
test('真实 Socket.IO 多客户端：组房、权限、重放、旧版本、恢复、托管、转交、退出与磁盘恢复',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scout-network-')),dbPath=path.join(dir,'test.sqlite'),sockets=[];
  let service=createScoutServer({dbPath,disconnectMs:25,aiDelayMs:0,tickMs:100000});
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
    service=createScoutServer({dbPath,disconnectMs:25,aiDelayMs:0,tickMs:100000});port=await service.listen(0);
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

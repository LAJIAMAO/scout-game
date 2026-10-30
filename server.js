'use strict';
const express=require('express'),http=require('node:http'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {Server}=require('socket.io');
const ScoutGame=require('./game/scoutGame'),AI=require('./game/ai');
const APP_VERSION=require('./package.json').version;
const P=require('./public/presentation');
const hash=s=>createHash('sha256').update(s).digest('hex');
const cleanName=s=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,16):'';
function networkAddresses(port){
  const out=[];
  for(const [name,addresses] of Object.entries(os.networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal){
    const privateIP=/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
    out.push({name,address:a.address,url:`http://${a.address}:${port}`,private:privateIP,virtual:!privateIP||/virtual|vpn|vbox|vmware|hyper-v|wsl|tailscale|tun|meta|clash|mihomo/i.test(name)});
  }
  return out.sort((a,b)=>Number(b.private)-Number(a.private)||Number(a.virtual)-Number(b.virtual));
}
function createScoutServer(options={}){
  const dbPath=options.dbPath||process.env.SCOUT_DB||path.join(__dirname,'data','scout.sqlite');
  if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, snapshot TEXT NOT NULL, touched INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS results(match_id TEXT, round INTEGER, data TEXT NOT NULL, PRIMARY KEY(match_id,round));');
  const save=db.prepare('INSERT OR REPLACE INTO rooms VALUES(?,?,?)'),del=db.prepare('DELETE FROM rooms WHERE code=?'),saveResult=db.prepare('INSERT OR REPLACE INTO results VALUES(?,?,?)');
  const rooms=new Map(),connections=new Map();let closing=false;
  const grace=options.disconnectMs??90000,aiDelay=options.aiDelayMs??1600;
  const clock=options.clock||Date.now,presentationScale=options.presentationScale??1;
  function stampPresentation(g,previousId){
    const a=g.lastAction;if(!a||a.id===previousId)return;
    a.startedAt=clock();a.durationMs=Math.round(P.DURATIONS[a.kind]*presentationScale);a.until=a.startedAt+a.durationMs;
    a.settlementAt=a.roundEnded?a.until+Math.round(P.CURTAIN_MS*presentationScale):0;
    g.presentationUntil=a.settlementAt||a.until;g.settlementAt=a.settlementAt;
  }
  function presentationBusy(g){return clock()<(g.presentationUntil||0);}
  function busyResponse(g){return {success:false,code:'PRESENTATION_BUSY',msg:'正在展示上一位玩家的行动，请稍候',retryAfterMs:Math.max(0,g.presentationUntil-clock())};}
  for(const row of db.prepare('SELECT * FROM rooms').all()){
    if(Date.now()-row.touched>24*60*60*1000){del.run(row.code);continue;}
    try{
      const snapshot=JSON.parse(row.snapshot),game=ScoutGame.restore(snapshot.game);
      game.players.forEach(p=>{if(!p.isBot){p.connected=false;p.disconnectedAt=Date.now();}});
      game.version++;rooms.set(row.code,{game,requests:snapshot.requests||[],touched:Date.now(),botDue:null});
    }catch(e){console.error('无法读取一个历史房间，已保留数据库供检查。',e.message);}
  }
  const app=express(),server=http.createServer(app);
  app.disable('x-powered-by');
  app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");next();});
  app.get('/health',(_,res)=>res.json({ok:true,version:APP_VERSION}));
  app.get('/api/network',(_,res)=>{const port=server.address()?.port;res.json({port,local:`http://localhost:${port}`,addresses:networkAddresses(port),disconnectSeconds:grace/1000});});
  app.use(express.static(path.join(__dirname,'public'),{etag:true,maxAge:0}));
  const io=new Server(server,{maxHttpBufferSize:32768,allowRequest:(req,cb)=>{
    const origin=req.headers.origin;let ok=!origin;try{ok=ok||new URL(origin).host===req.headers.host;}catch{}
    cb(null,ok);
  }});
  function persist(r){
    r.touched=Date.now();db.exec('BEGIN IMMEDIATE');
    try{
      save.run(r.game.roomId,JSON.stringify({game:r.game,requests:r.requests}),r.touched);
      if(r.game.matchId)for(const result of r.game.history)saveResult.run(r.game.matchId,result.round,JSON.stringify(result));
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function broadcast(r){
    for(const p of r.game.players){const sid=connections.get(p.id);if(sid)io.to(sid).emit('game_state_update',r.game.getClientState(p.id));}
  }
  function commit(r){r.game.version++;persist(r);broadcast(r);}
  function transferHost(g){
    const host=g.players.find(p=>p.id===g.hostId);
    if(!host||host.left||!host.connected&&host.controlled){
      const next=g.players.find(p=>!p.isBot&&p.connected&&!p.left);
      if(next&&next.id!==g.hostId){g.hostId=next.id;g.log(`${next.name} 接任房主`);}
    }
  }
  function code(){let v;const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';do{v=[...randomBytes(4)].map(n=>alphabet[n%alphabet.length]).join('');}while(rooms.has(v));return v;}
  function detach(socket,explicit=false){
    const r=rooms.get(socket.data.roomId);if(!r)return;
    const p=r.game.players.find(p=>p.id===socket.data.playerId);if(!p||connections.get(p.id)!==socket.id)return;
    connections.delete(p.id);p.connected=false;p.disconnectedAt=Date.now();
    if(explicit){p.left=true;p.controlled=true;r.game.log(`${p.name} 离开房间`);
      if(r.game.phase==='LOBBY')r.game.players=r.game.players.filter(q=>q.id!==p.id);
      transferHost(r.game);
    }
    socket.leave(r.game.roomId);socket.data.roomId=null;socket.data.playerId=null;
    if(!closing)commit(r);
  }
  function attach(socket,r,p,token){
    const old=connections.get(p.id);
    if(old&&old!==socket.id){const prior=io.sockets.sockets.get(old);if(prior){prior.data.roomId=null;prior.data.playerId=null;prior.emit('session_replaced');prior.disconnect(true);}}
    socket.data.roomId=r.game.roomId;socket.data.playerId=p.id;connections.set(p.id,socket.id);socket.join(r.game.roomId);
    p.connected=true;p.disconnectedAt=null;p.controlled=false;
    transferHost(r.game);commit(r);
    const joined={roomId:r.game.roomId,playerId:p.id,isHost:r.game.hostId===p.id,...(token?{token}:{})};
    socket.emit('room_joined',joined);socket.emit('game_state_update',r.game.getClientState(p.id));return joined;
  }
  io.on('connection',socket=>{
    let count=0,windowAt=Date.now();
    function limited(){if(Date.now()-windowAt>5000){count=0;windowAt=Date.now();}return ++count>45;}
    function register(event,handler){socket.on(event,(data={},ack)=>{
      const reply=typeof ack==='function'?ack:()=>{};
      if(limited())return reply({success:false,msg:'操作太快，请稍等一下'});
      if(!data||typeof data!=='object'||Array.isArray(data))return reply({success:false,msg:'无效的操作数据'});
      try{reply(handler(data));}catch(e){console.error(`操作 ${event} 未完成：`,e.message);reply({success:false,msg:'操作未完成，请重新连接后重试'});}
    });}
    register('create_room',data=>{
      if(socket.data.roomId)return {success:false,msg:'请先离开当前房间'};
      if(rooms.size>=200)return {success:false,msg:'房间较多，请稍后再试'};
      const roomId=code(),game=new ScoutGame(roomId,data.settings||{}),r={game,requests:[],touched:Date.now(),botDue:null};
      const token=randomBytes(32).toString('hex'),id=randomUUID();game.addPlayer(id,cleanName(data.playerName)||'团长');game.players[0].tokenHash=hash(token);
      if(game.settings.practice)for(let i=0;i<2;i++)game.addPlayer(randomUUID(),['露露 · 杂技师','阿奇 · 魔术师'][i],true);
      rooms.set(roomId,r);const joined=attach(socket,r,game.players[0],token);
      if(game.settings.practice){game.matchId=randomUUID();game.startNewGame();commit(r);}
      return {success:true,...joined};
    });
    register('join_room',data=>{
      if(socket.data.roomId)return {success:false,msg:'请先离开当前房间'};
      const roomId=typeof data.roomId==='string'?data.roomId.trim().toUpperCase():'';
      const r=rooms.get(roomId);if(!r)return {success:false,msg:'没有找到这个房间，请核对四位房间号'};
      if(r.game.phase!=='LOBBY')return {success:false,msg:'这局已经开始，请等待下一局'};
      if(r.game.players.length>=5)return {success:false,msg:'房间已经坐满了'};
      const id=randomUUID(),token=randomBytes(32).toString('hex');r.game.addPlayer(id,cleanName(data.playerName)||`演员 ${r.game.players.length+1}`);
      const p=r.game.players.at(-1);p.tokenHash=hash(token);return {success:true,...attach(socket,r,p,token)};
    });
    register('room_rejoin',data=>{
      if(socket.data.roomId)return {success:false,msg:'已经连接到房间'};
      const r=rooms.get(data.roomId);
      if(!r||typeof data.token!=='string'||data.token.length!==64)return {success:false,msg:'原房间已关闭，请重新创建或加入'};
      const p=r.game.players.find(p=>!p.isBot&&!p.left&&p.tokenHash===hash(data.token));
      if(!p)return {success:false,msg:'无法恢复这个座位，请重新加入'};
      return {success:true,...attach(socket,r,p)};
    });
    const actions={
      flip_hand:(g,p)=>g.flipHand(p.id),ready:(g,p)=>g.setReady(p.id),
      action_show:(g,p,d)=>g.playShow(p.id,d.selectedIndices),
      action_scout:(g,p,d)=>g.playScout(p.id,d.side,d.flip,d.insertIndex),
      action_scout_and_show:(g,p,d)=>g.playScoutAndShow(p.id,d.scoutData,d.showIndices),
      add_bot:(g,p,d)=>{
        if(g.hostId!==p.id||g.phase!=='LOBBY')return {success:false,msg:'只有房主能在大厅添加电脑'};
        if(g.players.length>=5)return {success:false,msg:'房间已满'};
        const level=['easy','normal','hard'].includes(d.difficulty)?d.difficulty:g.settings.difficulty;
        g.addPlayer(randomUUID(),['露露 · 杂技师','阿奇 · 魔术师','米娅 · 空中飞人','奥利 · 小丑'][g.players.filter(p=>p.isBot).length%4],true,level);return {success:true};
      },
      remove_bot:(g,p,d)=>{if(g.hostId!==p.id||g.phase!=='LOBBY'||!g.players.some(q=>q.id===d.botId&&q.isBot))return {success:false,msg:'当前不能移除此玩家'};g.players=g.players.filter(q=>q.id!==d.botId);return {success:true};},
      update_settings:(g,p,d)=>{if(g.hostId!==p.id||g.phase!=='LOBBY'||typeof d.allowHints!=='boolean')return {success:false,msg:'仅房主可在大厅调整设置'};g.settings.allowHints=d.allowHints;return {success:true};},
      start_game:(g,p)=>{if(g.hostId!==p.id)return {success:false,msg:'请等待房主开始'};const result=g.startNewGame();if(result.success)g.matchId=randomUUID();return result;},
      next_round:(g,p)=>g.hostId===p.id?g.startRound():{success:false,msg:'请等待房主开始下一轮'},
      restart_game:(g,p)=>{if(g.hostId!==p.id)return {success:false,msg:'请等待房主开始'};const result=g.startNewGame();if(result.success)g.matchId=randomUUID();return result;},
      return_lobby:(g,p)=>{if(g.hostId!==p.id||!['ROUND_OVER','GAME_OVER'].includes(g.phase))return {success:false,msg:'请等待结算后由房主返回大厅'};g.players=g.players.filter(q=>!q.left);g.phase='LOBBY';g.currentShow=null;g.log('回到大厅，可以调整席位');return {success:true};}
    };
    for(const [event,handler] of Object.entries(actions))register(event,data=>{
      const r=rooms.get(socket.data.roomId),id=socket.data.playerId;
      if(!r||connections.get(id)!==socket.id)return {success:false,msg:'连接尚未恢复，请稍候'};
      if(typeof data.actionId!=='string'||!/^[\w-]{8,80}$/.test(data.actionId))return {success:false,msg:'缺少有效的操作编号'};
      const previous=r.requests.find(q=>q.playerId===id&&q.id===data.actionId);
      if(previous)return {...previous.result,duplicate:true};
      if(presentationBusy(r.game)&&['action_show','action_scout','action_scout_and_show','start_game','next_round','restart_game','return_lobby'].includes(event))return busyResponse(r.game);
      if(!Number.isInteger(data.version)||data.version!==r.game.version){broadcast(r);return {success:false,msg:'牌桌已更新，请重新选择',stale:true};}
      const p=r.game.players.find(p=>p.id===id);
      const backup=JSON.stringify(r.game),previousActionId=r.game.lastAction?.id,result=handler(r.game,p,data);
      if(!result.success)return result;
      stampPresentation(r.game,previousActionId);
      r.game.version++;const response={...result,success:true,version:r.game.version};
      r.requests.push({playerId:id,id:data.actionId,result:response});r.requests=r.requests.slice(-500);
      try{persist(r);}catch(e){r.game=ScoutGame.restore(JSON.parse(backup));r.requests.pop();throw e;}
      broadcast(r);return response;
    });
    register('request_hint',()=>{
      const r=rooms.get(socket.data.roomId),id=socket.data.playerId;
      if(!r||!r.game.settings.allowHints||!r.game.checkTurn(id).success)return {success:false,msg:'当前不能使用建议'};
      if(presentationBusy(r.game))return busyResponse(r.game);
      const move=AI.choose(r.game.getClientState(id),'hard');return move?{success:true,event:move.event,data:move.data,label:move.label,msg:'建议依据当前手牌结构与公开局势，结果不保证最优'}:{success:false,msg:'当前没有可执行的行动'};
    });
    register('leave_room',()=>{detach(socket,true);return {success:true};});
    socket.on('disconnect',()=>detach(socket));
  });
  function tick(){
    if(closing)return;
    const now=clock();
    for(const [roomId,r] of rooms){
      const g=r.game,online=g.players.filter(p=>!p.isBot&&p.connected&&!p.left);
      if(!online.length){r.botDue=null;if(now-r.touched>24*60*60*1000){rooms.delete(roomId);del.run(roomId);}continue;}
      let changed=false;
      for(const p of [...g.players])if(!p.isBot&&!p.connected&&!p.controlled&&p.disconnectedAt&&now-p.disconnectedAt>=grace){
        p.controlled=true;changed=true;
        if(g.phase==='LOBBY'){g.players=g.players.filter(q=>q.id!==p.id);g.log(`${p.name} 离线，座位已释放`);}
        else g.log(`${p.name} 离线超时，电脑暂时代管`);
      }
      if(changed){transferHost(g);commit(r);}
      if(!['PREPARE','PLAYING'].includes(g.phase)){r.botDue=null;continue;}
      if(presentationBusy(g)){r.botDue=null;continue;}
      const actor=g.phase==='PREPARE'?g.players.find(p=>!p.isReady&&(p.isBot||p.controlled)):g.players[g.activePlayerIndex];
      if(!actor||!(actor.isBot||actor.controlled)){r.botDue=null;continue;}
      const key=`${g.phase}:${actor.id}:${g.version}`;
      if(!r.botDue||r.botDue.key!==key){r.botDue={key,at:now+aiDelay};continue;}
      if(now<r.botDue.at)continue;
      r.botDue=null;
      if(g.phase==='PREPARE'){if(AI.prepare(actor.hand))g.flipHand(actor.id);g.setReady(actor.id);commit(r);}
      else{
        const move=AI.choose(g.getClientState(actor.id),actor.difficulty);
        if(move){let result;const previousActionId=g.lastAction?.id;
          if(move.event==='action_show')result=g.playShow(actor.id,move.data.selectedIndices);
          else if(move.event==='action_scout')result=g.playScout(actor.id,move.data.side,move.data.flip,move.data.insertIndex);
          else result=g.playScoutAndShow(actor.id,move.data.scoutData,move.data.showIndices);
          if(result.success){stampPresentation(g,previousActionId);commit(r);}else console.error('电脑行动校验失败',result.msg);
        }else{g.checkDuelBlocked();commit(r);}
      }
    }
  }
  const timer=setInterval(()=>{try{tick();}catch(e){console.error('自动流程暂停：',e.message);}},options.tickMs??200);
  timer.unref();
  async function listen(port=3210,host='0.0.0.0'){
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
    return server.address().port;
  }
  async function close(){closing=true;clearInterval(timer);for(const r of rooms.values())persist(r);await new Promise(resolve=>io.close(resolve));db.close();}
  return {app,server,io,rooms,listen,close,tick};
}
if(require.main===module){
  const service=createScoutServer();
  (async()=>{
    let port=Number(process.env.PORT)||3210;
    for(let tries=0;;tries++){try{await service.listen(port);break;}catch(e){if(e.code==='EADDRINUSE'&&tries<19&&!process.env.PORT)port++;else throw e;}}
    console.log(`\n🎪 马戏星探 SCOUT v${APP_VERSION} · 同一网络联机版\n`);
    console.log(`本机打开：http://localhost:${port}`);
    for(const a of networkAddresses(port))console.log(`${a.virtual?'虚拟网卡（通常不选）':'手机 / 好友'} [${a.name}]：${a.url}`);
    console.log('\n大家连接同一 Wi-Fi，输入上方地址，再通过四位房间号加入。\n游玩时保持此窗口运行。按 Ctrl+C 停止，房间会保存在 data 文件夹。\n');
    if(process.env.SCOUT_SMOKE==='1')console.log(`SCOUT_SMOKE_PID=${process.pid}`);
    if(process.env.SCOUT_OPEN==='1'&&process.env.SCOUT_SMOKE!=='1'&&process.platform==='win32')require('node:child_process').execFile('cmd.exe',['/d','/c','start','',`http://localhost:${port}`],()=>{});
    process.send?.({port});
  })().catch(e=>{console.error('启动失败：',e.message);service.close().finally(()=>process.exit(1));});
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!stopping){stopping=true;service.close().finally(()=>process.exit(0));}});
}
module.exports={createScoutServer,networkAddresses};

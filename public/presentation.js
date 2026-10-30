(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ScoutPresentation=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DURATIONS={show:2000,scout:2600,scout_show:4000},CURTAIN_MS=2800;
  function phaseAt(a,now){
    if(!a||now>=Math.max(a.until||0,a.settlementAt||0))return 'done';
    if(now>=a.until)return a.roundEnded?'curtain':'done';
    const t=(now-a.startedAt)/Math.max(1,a.durationMs);
    if(a.kind==='scout_show')return t<.34?'scout':t<.68?'show':'landed';
    return t<(a.kind==='scout'?.5:.65)?a.kind:'landed';
  }
  function stageAt(a,now){const p=phaseAt(a,now);return p==='scout'?a.beforeStage:p==='show'?(a.kind==='scout_show'?a.afterScoutStage:a.beforeStage):a.afterStage;}
  function milestones(a){if(!a)return [];const cuts=a.kind==='scout_show'?[.34,.68]:[a.kind==='scout'?.5:.65];return [...cuts.map(x=>a.startedAt+a.durationMs*x),a.until,a.settlementAt].filter(Boolean).sort((a,b)=>a-b);}
  return {DURATIONS,CURTAIN_MS,phaseAt,stageAt,milestones};
});

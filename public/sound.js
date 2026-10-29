'use strict';
window.Sound={
  ctx:null,enabled:true,volume:.35,
  play(kind='click'){
    if(!this.enabled||!this.volume)return;
    try{
      this.ctx??=new (window.AudioContext||window.webkitAudioContext)();
      if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});
      const frequencies={click:[420],show:[330,495],scout:[440,554],combo:[440,554,660],turn:[660,880],win:[392,494,587,784]}[kind]||[420];
      frequencies.forEach((f,i)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain(),t=this.ctx.currentTime+i*.065;o.type='sine';o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(this.volume*.22,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+.15);o.connect(g);g.connect(this.ctx.destination);o.start(t);o.stop(t+.17);o.onended=()=>{o.disconnect();g.disconnect();};});
    }catch{/* Devices without audio still have the complete visual experience. */}
  }
};

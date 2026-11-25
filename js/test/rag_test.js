// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
const M=require('../core.js'); const st={bounce:1,stride:1,arm:1,lean:1,step:1,snap:0.3};
function bad(o,p=''){ if(typeof o==='number') return isFinite(o)?null:p; if(o&&typeof o==='object') for(const k in o){const r=bad(o[k],p+'.'+k); if(r) return r;} return null; }
const rough=L=>x=>L*(0.10*Math.sin(x/(1.9*L))+0.05*Math.sin(x/(0.73*L)+1.3));
for(const id of Object.keys(M.CHARACTERS)) for(const sc of ['stand','run','jump','ladder']){
  const ch=M.CHARACTERS[id]; if(sc==='ladder'&&ch.kind!=='biped') continue;
  const env={terrain:rough(ch.L)}; const S=M.createState(ch,env); const inp={speed:sc==='run'?ch.vmax*0.7:0,crouch:0,aim:null,fire:false,armed:true,jump:false};
  for(let i=0;i<360;i++) M.step(S,ch,inp,st,env,1/120);
  if(sc==='jump'){ inp.jump=true; M.step(S,ch,inp,st,env,1/120); inp.jump=false; for(let i=0;i<50;i++) M.step(S,ch,inp,st,env,1/120); }
  if(sc==='ladder'){ env.ladder={x:S.x+.36,y0:env.terrain(S.x+.36),spacing:.3,rung:k=>env.ladder.y0+k*.3}; M.enterLadder(S,ch,env); inp.speed=3; for(let i=0;i<600;i++) M.step(S,ch,inp,st,env,1/120); }
  const y0=S.y; inp.die=true; let nan=null, sleepT=null, maxErr=0, under=0;
  for(let i=0;i<120*7;i++){ const p=M.step(S,ch,inp,st,env,1/120); inp.die=false; nan=nan||bad(p);
    if(S.rag){ S.rag.bones.forEach(b=>{const d=Math.hypot(b[0].p[0]-b[1].p[0],b[0].p[1]-b[1].p[1],b[3]===undefined?b[0].z-b[1].z:b[3]); maxErr=Math.max(maxErr,Math.abs(d-b[2])/ch.L);});
      S.rag.list.forEach(q=>{under=Math.max(under,(env.terrain(q.p[0])+q.r-q.p[1])/ch.L)}); if(S.rag.asleep&&sleepT===null) sleepT=S.rag.t; } }
  const hi=Math.max(...S.rag.list.map(q=>q.p[1]-env.terrain(q.p[0])-q.r))/ch.L;
  M.stand(S,ch,env); const p2=M.step(S,ch,{speed:1,crouch:0,aim:null,fire:false,armed:true},st,env,1/120);
  console.log(id.padEnd(8),sc.padEnd(6),'nan',nan,'| from y',y0.toFixed(2),'| rest after',sleepT===null?'never':sleepT.toFixed(2)+'s','| highest joint above ground',hi.toFixed(2)+'L','| bone err',(maxErr*100).toFixed(2)+'%L','| under',under.toFixed(3),'| stand',bad(p2)||S.mode);
}

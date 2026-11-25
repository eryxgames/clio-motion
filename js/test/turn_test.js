// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
const M=require('../core.js'); const st={bounce:1,stride:1,arm:1,lean:1,step:1,snap:0.3};
function bad(o,p=''){ if(typeof o==='number') return isFinite(o)?null:p; if(o&&typeof o==='object') for(const k in o){const r=bad(o[k],p+'.'+k); if(r) return r;} return null; }
const rough=L=>x=>L*(0.10*Math.sin(x/(1.9*L))+0.05*Math.sin(x/(0.73*L)+1.3));
const cases={ 'turn in place 180':{speed:0,heading:Math.PI}, 'walk, turn round':{speed:'walk',heading:Math.PI}, 'run, turn round':{speed:'run',heading:Math.PI}, 'walk, steer hard':{speed:'walk',steer:1}, 'run, steer':{speed:'run',steer:0.6} };
for(const id of Object.keys(M.CHARACTERS)) for(const name in cases){ const c=cases[name], ch=M.CHARACTERS[id], env={terrain:rough(ch.L)}, S=M.createState(ch,env);
  const v=c.speed==='walk'?Math.sqrt(0.22*9.81*ch.L):c.speed==='run'?Math.min(ch.vmax,Math.sqrt(1.7*9.81*ch.L)):0; const inp={speed:v,crouch:0,aim:null,fire:false,armed:true};
  for(let i=0;i<480;i++) M.step(S,ch,inp,st,env,1/120);
  if(c.heading!=null) inp.heading=c.heading; else inp.steer=c.steer;
  let nan=null, slide=0, drop=0, tDone=null, steps=0, bank=0, stretch=0; const last=S.legs.map(()=>null);
  for(let i=0;i<120*8;i++){ const p=M.step(S,ch,inp,st,env,1/120); nan=nan||bad(p);
    p.legs.forEach((l,k)=>{ if(l.planted&&last[k]) slide=Math.max(slide,Math.hypot(l.ball[0]-last[k][0],l.ball[2]-last[k][2])); last[k]=l.planted&&!S.legs[k].swing?l.ball.slice():null;
      const ld=ch.legs[k]; stretch=Math.max(stretch,Math.hypot(l.ankle[0]-l.hip[0],l.ankle[1]-l.hip[1],l.ankle[2]-l.hip[2])/(ld.upper+ld.lower)); });
    steps+=S.events.filter(e=>e.type==='land').length; S.events.length=0; drop=Math.max(drop,S.reachDrop/ch.L); bank=Math.max(bank,Math.abs(S.bank.x));
    if(c.heading!=null&&tDone===null&&Math.abs(M.wrapPi(c.heading-S.h))<0.03) tDone=(i+1)/120; }
  console.log(id.padEnd(8),name.padEnd(18),'nan',nan,'| planted feet moved',slide.toExponential(1)+' m','| body sink',drop.toFixed(3)+'L','| leg reach',stretch.toFixed(3),'| bank',(bank*57.3).toFixed(0)+'°',c.heading!=null?'| 180° in '+(tDone===null?'never':tDone.toFixed(2)+' s'):'| heading now '+(S.h*57.3).toFixed(0)+'°','| speed',S.v.toFixed(2)); }

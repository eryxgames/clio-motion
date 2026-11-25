// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
const M=require('../core.js'); const st={bounce:1,stride:1,arm:1,lean:1,step:1,snap:0.3};
function bad(o,p=''){ if(typeof o==='number') return isFinite(o)?null:p; if(o&&typeof o==='object') for(const k in o){const r=bad(o[k],p+'.'+k); if(r) return r;} return null; }
for(const id of Object.keys(M.CHARACTERS)) for(const sc of ['standing, from front','standing, from the side','walking, from front','walking, from behind']){
  const ch=M.CHARACTERS[id], env={terrain:x=>0}, S=M.createState(ch,env); const walk=sc.startsWith('walking'); const inp={speed:walk?Math.sqrt(0.22*9.81*ch.L):0,crouch:0,aim:null,fire:false,armed:true};
  for(let i=0;i<480;i++) M.step(S,ch,inp,st,env,1/120);
  const p0=[S.px,S.pz], x0=S.x, lean0=S.lean.x, y0=S.y; inp.hit={impulse: sc.includes('side')?[0,0,1.6]:sc.includes('behind')?[1.6,0,0]:[-1.6,0,0]};
  let nan=null, steps=0, leanMax=0, dip=0, tRec=null, slide=0; const last=S.legs.map(()=>null);
  for(let i=0;i<120*4;i++){ const p=M.step(S,ch,inp,st,env,1/120); inp.hit=null; nan=nan||bad(p); steps+=S.events.filter(e=>e.type==='land').length; S.events.length=0;
    p.legs.forEach((l,k)=>{ if(l.planted&&last[k]) slide=Math.max(slide,Math.hypot(l.ball[0]-last[k][0],l.ball[2]-last[k][2])); last[k]=l.planted&&!S.legs[k].swing?l.ball.slice():null; });
    leanMax=Math.max(leanMax,Math.abs(S.lean.x-lean0)); dip=Math.max(dip,(y0-S.y)/ch.L);
    const calm=Math.abs(S.lean.v)<0.05&&Math.abs(S.hop.x)<0.004*ch.L&&Math.hypot(S.kv[0],S.kv[1])<0.02&&(walk||!S.legs.some(l=>l.swing)); if(calm&&tRec===null&&i>20) tRec=(i+1)/120; if(!calm) tRec=null; }
  const push=Math.hypot(S.px-p0[0]-(walk?(S.x-x0):0), S.pz-p0[1]);
  console.log(id.padEnd(8),sc.padEnd(24),'nan',nan,'| pushed',(push/ch.L).toFixed(2)+'L','| torso thrown',(leanMax*57.3).toFixed(0)+'°','| knees dip',dip.toFixed(2)+'L','| feet landed',String(steps).padStart(2),'| planted feet moved',slide.toExponential(0),'| settled after',tRec===null?'no':tRec.toFixed(2)+' s','| mode',S.mode); }

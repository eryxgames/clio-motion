// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
const M=require('../core.js'); const st={bounce:1,stride:1,arm:1,lean:1,step:1,snap:0.3};
function bad(o,p=''){ if(typeof o==='number') return isFinite(o)?null:p; if(o&&typeof o==='object') for(const k in o){const r=bad(o[k],p+'.'+k); if(r) return r;} return null; }
const D=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// 1. sideways aim: how well does the weapon end up pointing at the target?
console.log('--- sideways aim (target 4 leg lengths away, at chest height)');
for(const id of Object.keys(M.CHARACTERS)) { const ch=M.CHARACTERS[id], out=[];
  for(const deg of [0,30,60,-45,120,180]){ const env={terrain:x=>0}, S=M.createState(ch,env); const a=deg/57.2958, R=4*ch.L; let p,nan=null;
    for(let i=0;i<480;i++){ p=M.step(S,ch,{speed:0,crouch:0,armed:true,aim:[S.px+R*Math.cos(a), S.y+0.2*ch.L, S.pz+R*Math.sin(a)]},st,env,1/120); nan=nan||bad(p); }
    const w=p.props?p.props[0]:p.mounts[0], o=p.props?w.o:w.base, t=[S.px+R*Math.cos(a),S.y+0.2*ch.L,S.pz+R*Math.sin(a)], to=[t[0]-o[0],t[1]-o[1],t[2]-o[2]], l=Math.hypot(...to);
    const err=Math.acos(Math.min(1,(w.dir[0]*to[0]+w.dir[1]*to[1]+w.dir[2]*to[2])/l))*57.3;
    out.push(deg+'°: twist '+(S.twist.x*57.3).toFixed(0)+'° off '+err.toFixed(0)+'°'+(nan?' NaN '+nan:'')); }
  console.log(id.padEnd(8), out.join(' | ')); }
// 2. prop rigidity and hands on grips, for both kits, in every state
console.log('--- props stay rigid; hands on their grips');
for(const kitName of ['rifle','pistols']){ const ch=M.CHARACTERS.soldier, env={terrain:x=>0.08*Math.sin(x)}, S=M.createState(ch,env); const inp={speed:1.4,crouch:0,armed:true,kit:kitName,aim:null,steer:0};
  let nan=null, maxLenErr=0, maxMagErr=0, maxGrip=[0,0], fired=0, events={}, t=0, reloadT=null, armReach=0;
  const script=(i)=>{ inp.fire=false; inp.reload=false; inp.aim=[S.px+3*Math.cos(S.h+0.6*Math.sin(i/200)), S.y+0.3+0.5*Math.sin(i/130), S.pz+3*Math.sin(S.h+0.6*Math.sin(i/200))];
    if(i>600&&i<1500) inp.fire=true; if(i===1700) inp.reload=true; if(i>2600&&i<2700) inp.steer=1; else inp.steer=0; if(i===3000) inp.jump=true; else inp.jump=false; if(i>=3300&&i<3600) inp.armed=false; else inp.armed=true; };
  for(let i=0;i<4200;i++){ script(i); const p=M.step(S,ch,inp,st,env,1/120); nan=nan||bad(p);
    S.events.forEach(e=>{events[e.type]=(events[e.type]||0)+1;}); S.events.length=0;
    p.props.forEach((w,k)=>{ const def=M.PROPS[w.kind]; maxLenErr=Math.max(maxLenErr,Math.abs(D(w.o,w.muzzle)-def.len)); if(!S.act) maxMagErr=Math.max(maxMagErr,Math.abs(D(w.magA,w.magB)-(def.magA[1]-def.magB[1])));
      if(S.armed.x>0.999 && !S.act){ maxGrip[0]=Math.max(maxGrip[0],D(p.arms[k].hand,w.grip)); if(w.fore) maxGrip[1]=Math.max(maxGrip[1],D(p.arms[1].hand,w.fore)); } });
    if(S.act&&reloadT===null) reloadT=i; }
  console.log(kitName.padEnd(8),'nan',nan,'| kit now',S.kit,'| prop length error',maxLenErr.toExponential(1),'m | magazine',maxMagErr.toExponential(1),'m | hand off grip',maxGrip.map(v=>(v*100).toFixed(1)+' cm').join(', '),'| events',JSON.stringify(events),'| ammo',S.ammo.join('+')); }
// 3. reload timeline
console.log('--- rifle reload: off hand and magazine');
{ const ch=M.CHARACTERS.soldier, env={terrain:x=>0}, S=M.createState(ch,env); const inp={speed:1.4,crouch:0,armed:true,aim:null}; let p;
  for(let i=0;i<400;i++) p=M.step(S,ch,inp,st,env,1/120); for(let i=0;i<60;i++){inp.fire=true; M.step(S,ch,inp,st,env,1/120);} inp.fire=false; inp.reload=true; let n=0, maxJump=0, last=null, lastMag=null, maxMagJump=0;
  while(n<400){ p=M.step(S,ch,inp,st,env,1/120); inp.reload=false; if(!S.act) break; const h=p.arms[1].hand, w=p.props[0];
    if(last){ maxJump=Math.max(maxJump,D(h,last)-1.4/120); maxMagJump=Math.max(maxMagJump,D(w.magB,lastMag)-1.4/120); } last=h.slice(); lastMag=w.magB.slice();
    if(n%24===0) console.log('  t',(n/120).toFixed(2),'s  hand→foregrip',(D(h,w.fore)*100).toFixed(0).padStart(3),'cm  magazine→hand',(D(w.magB,h)*100).toFixed(0).padStart(3),'cm  magazine→well',(D(w.magB,[w.o[0]+w.dir[0]*0.35-w.up[0]*0.15,w.o[1]+w.dir[1]*0.35-w.up[1]*0.15,w.o[2]+w.dir[2]*0.35-w.up[2]*0.15])*100).toFixed(0).padStart(3),'cm  ammo',S.ammo[0]); n++; }
  console.log('  took',(n/120).toFixed(2),'s | biggest hand move in one step',(maxJump*1000).toFixed(1),'mm | magazine',(maxMagJump*1000).toFixed(1),'mm | ammo after',S.ammo[0]); }

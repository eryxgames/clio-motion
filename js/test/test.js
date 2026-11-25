// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
const M = require('../core.js');
const st = {bounce:1,stride:1,arm:1,lean:1,step:1,snap:0.3};
function terr(kind, L){
  if(kind==='flat') return x=>0;
  if(kind==='rough') return x=>L*(0.10*Math.sin(x/(1.9*L))+0.05*Math.sin(x/(0.73*L)+1.3));
  return x=>{const k=((Math.floor(x/(1.3*L))%8)+8)%8; return L*0.17*[0,1,2,3,3,2,1,0][k];};
}
function bad(o,path=''){ if(typeof o==='number'){ if(!isFinite(o)) return path; return null;} if(o&&typeof o==='object'){ for(const k in o){const r=bad(o[k],path+'.'+k); if(r) return r;} } return null; }
for(const id of Object.keys(M.CHARACTERS)){
  const ch=M.CHARACTERS[id];
  for(const tk of ['flat','rough','steps']){
    const env={terrain:terr(tk,ch.L)};
    const S=M.createState(ch,env);
    const dt=1/120; let maxSlide=0,maxGap=0,maxDrop=0,minKneeY=1e9, nan=null, maxStretch=0;
    const prev=S.legs.map(l=>l.ball.slice());
    const plan=[[0,1],[0.25,6],[0.6,5],[1,6],[0.1,4],[0,3],[0.45,5]];
    let T=0, seg=0, segT=0, steps=0, yMin=1e9,yMax=-1e9;
    const log=[];
    while(seg<plan.length){
      const inp={speed:plan[seg][0]*ch.vmax,crouch:(seg===6?0.8:0),aim:[S.x+3*ch.L,S.y+ch.L],fire:seg===3,armed:true};
      const pose=M.step(S,ch,inp,st,env,dt);
      nan = nan || bad(pose) || bad(S.stats);
      S.legs.forEach((l,i)=>{
        if(!l.swing && pose.legs[i].planted){ // planted: ball must not move
          const d=Math.abs(l.ball[0]-prev[i][0]); if(l._wasPl) maxSlide=Math.max(maxSlide,d);
          // foot reach gap: IK end vs wanted ankle is the leg overstretch
        }
        l._wasPl=!l.swing; prev[i]=l.ball.slice();
        const ld=ch.legs[i]; const hip=pose.legs[i].hip, an=pose.legs[i].ankle;
        const dist=Math.hypot(an[0]-hip[0],an[1]-hip[1],an[2]-hip[2]);
        maxStretch=Math.max(maxStretch, dist/(ld.upper+ld.lower));
        minKneeY=Math.min(minKneeY,pose.legs[i].knee[1]-env.terrain(pose.legs[i].knee[0]));
      });
      maxDrop=Math.max(maxDrop,S.reachDrop/ch.L);
      S.events.length=0;
      segT+=dt; T+=dt;
      if(segT>=plan[seg][1]){ log.push(`${(plan[seg][0]*ch.vmax).toFixed(1)}m/s:${S.stats.gait[0]} Fr${S.stats.Fr.toFixed(2)} st${S.stats.stride.toFixed(2)} d${S.stats.duty.toFixed(2)} ${S.stats.steps.toFixed(0)}spm drop${(S.reachDrop/ch.L).toFixed(3)}`); seg++; segT=0; }
    }
    console.log(id.padEnd(8),tk.padEnd(6),'nan:',nan,'slide',maxSlide.toExponential(1),'maxDrop/L',maxDrop.toFixed(3),'stretch',maxStretch.toFixed(3),'minKnee',minKneeY.toFixed(2));
    if(tk==='flat') console.log('   ',log.join(' | '));
  }
}
// ladder
{ const ch=M.CHARACTERS.soldier; const env={terrain:x=>0, ladder:{x:0.36,y0:0,spacing:0.3,rung:k=>k*0.3+0.035*Math.sin(k*2.4)}};
  const S=M.createState(ch,env); for(let i=0;i<120;i++) M.step(S,ch,{speed:0,crouch:0,armed:true},st,env,1/120);
  M.enterLadder(S,ch,env); let nan=null, grips=0, maxArm=0,maxLeg=0;
  for(let i=0;i<120*10;i++){ const p=M.step(S,ch,{speed:i<900?2.5:0,crouch:0,armed:true},st,env,1/120); nan=nan||bad(p);
    grips+=S.events.filter(e=>e.type==='grip').length; S.events.length=0;
    p.arms.forEach((a,j)=>{maxArm=Math.max(maxArm,Math.hypot(a.hand[0]-a.shoulder[0],a.hand[1]-a.shoulder[1],a.hand[2]-a.shoulder[2])/0.56)});
    p.legs.forEach(l=>{maxLeg=Math.max(maxLeg,Math.hypot(l.ankle[0]-l.hip[0],l.ankle[1]-l.hip[1],l.ankle[2]-l.hip[2])/0.87)});
  }
  console.log('ladder nan',nan,'grips',grips,'y',S.y.toFixed(2),'limb rungs',S.lad.limbs.map(l=>l.k).join(','),'armReach',maxArm.toFixed(2),'legReach',maxLeg.toFixed(2));
  M.leaveLadder(S,ch,env); const p=M.step(S,ch,{speed:1,crouch:0,armed:true},st,env,1/120); console.log('leave ok', bad(p));
}

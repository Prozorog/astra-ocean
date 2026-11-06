const before=document.querySelector('#before'),after=document.querySelector('#after'),clips=[before,after],play=document.querySelector('#play'),scrub=document.querySelector('#scrub');
let playing=true,side=true,showA=true,raf=0,wasPlaying=true;
const ready=v=>v.readyState>=2?Promise.resolve():new Promise(resolve=>v.addEventListener('loadeddata',resolve,{once:true}));
function seek(t){for(const v of clips)v.currentTime=t;}
function pause(){playing=false;clips.forEach(v=>v.pause());play.textContent='Play';}
async function resume(){playing=true;after.currentTime=before.currentTime;await Promise.all(clips.map(v=>v.play().catch(()=>{})));play.textContent='Pause';schedule();}
function layout(){document.body.classList.toggle('flip',!side);document.querySelector('#a').hidden=!side&&!showA;document.querySelector('#b').hidden=!side&&showA;document.querySelector('#flip').textContent=`A/B flip · show ${showA?'B':'A'}`;}
play.onclick=()=>playing?pause():void resume();document.querySelector('#restart').onclick=()=>seek(0);
document.querySelector('#flip').onclick=()=>{if(side){side=false;showA=true;}else showA=!showA;layout();};document.querySelector('#side').onclick=()=>{side=true;layout();};
scrub.addEventListener('input',()=>{pause();seek(Number(scrub.value));});
function tick(){raf=0;if(document.hidden)return;const t=before.currentTime;if(playing){const d=Math.abs(after.currentTime-t);if(Math.min(d,Math.abs(3.63-d))>.025)after.currentTime=t;if(document.activeElement!==scrub)scrub.value=String(t);}document.querySelector('#clock').value=`${t.toFixed(2)} / 3.63 s`;schedule();}
function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){wasPlaying=playing;pause();cancelAnimationFrame(raf);raf=0;}else {if(wasPlaying)void resume();schedule();}});
await Promise.all(clips.map(ready));await resume();window.__compare={ready:true,seek,pause,play:resume};

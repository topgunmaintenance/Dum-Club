/**
 * Interactive HTML5 templates for Dum Club embedded storefronts.
 * Each template is a self-contained HTML string rendered in a sandboxed iframe.
 * Dark themed (#07071A bg, #00FFA3 accent), touch-responsive, no external deps.
 */

const DUM_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #07071A; color: #F0F0FF; font-family: -apple-system, sans-serif; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100vh; }
  canvas { display: block; border: 1px solid #1a1a2e; border-radius: 8px; }
  .info { position: absolute; top: 12px; left: 12px; font-size: 12px; color: #00FFA3; font-family: monospace; }
  .score { position: absolute; top: 12px; right: 12px; font-size: 14px; color: #00FFA3; font-family: monospace; font-weight: bold; }
  .msg { text-align: center; color: #555; font-size: 13px; margin-top: 16px; }
  button { background: #00FFA3; color: #07071A; border: none; padding: 8px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; }
  button:hover { background: #00e693; }
`;

// ── TETRIS ──
const tetris = `<!DOCTYPE html><html><head><style>${DUM_STYLE}</style></head><body>
<div class="info">TETRIS</div><div class="score" id="sc">0</div>
<canvas id="c" width="200" height="400"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d'),W=10,H=20,S=20;
let grid=Array.from({length:H},()=>Array(W).fill(0)),score=0,piece,px,py,iv;
const shapes=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[0,1,0],[1,1,1]]];
const cols=['#00FFA3','#7B61FF','#FF6B35','#38BDF8','#FBBF24','#F472B6','#A78BFA'];
function np(){const i=Math.floor(Math.random()*shapes.length);piece={s:shapes[i],c:cols[i]};px=3;py=0;}
function ok(s,tx,ty){return s.every((r,y)=>r.every((v,x)=>!v||(tx+x>=0&&tx+x<W&&ty+y<H&&!grid[ty+y]?.[tx+x])));}
function merge(){piece.s.forEach((r,y)=>r.forEach((v,cx)=>{if(v)grid[py+y][px+cx]=piece.c;}));}
function clear(){let n=0;grid=grid.filter(r=>{if(r.every(c=>c)){n++;return false;}return true;});while(grid.length<H)grid.unshift(Array(W).fill(0));score+=n*100;document.getElementById('sc').textContent=score;}
function draw(){x.fillStyle='#07071A';x.fillRect(0,0,200,400);grid.forEach((r,y)=>r.forEach((c,cx)=>{if(c){x.fillStyle=c;x.fillRect(cx*S+1,y*S+1,S-2,S-2);}}));if(piece)piece.s.forEach((r,y)=>r.forEach((v,cx)=>{if(v){x.fillStyle=piece.c;x.fillRect((px+cx)*S+1,(py+y)*S+1,S-2,S-2);}}));}
function rot(){const s=piece.s[0].map((_,i)=>piece.s.map(r=>r[i]).reverse());if(ok(s,px,py))piece.s=s;}
function tick(){if(ok(piece.s,px,py+1)){py++;}else{merge();clear();np();if(!ok(piece.s,px,py)){grid=Array.from({length:H},()=>Array(W).fill(0));score=0;document.getElementById('sc').textContent=0;}}draw();}
document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'&&ok(piece.s,px-1,py))px--;if(e.key==='ArrowRight'&&ok(piece.s,px+1,py))px++;if(e.key==='ArrowDown')tick();if(e.key==='ArrowUp')rot();draw();});
let tx=0;c.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;});
c.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)<30)rot();else if(dx<0&&ok(piece.s,px-1,py))px--;else if(dx>0&&ok(piece.s,px+1,py))px++;draw();});
np();iv=setInterval(tick,500);draw();
</script></body></html>`;

// ── SNAKE ──
const snake = `<!DOCTYPE html><html><head><style>${DUM_STYLE}</style></head><body>
<div class="info">SNAKE</div><div class="score" id="sc">0</div>
<canvas id="c" width="300" height="300"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d'),S=15,W=20,H=20;
let sn=[{x:10,y:10}],d={x:1,y:0},food={x:5,y:5},score=0,alive=true;
function draw(){x.fillStyle='#07071A';x.fillRect(0,0,300,300);x.fillStyle='#00FFA3';sn.forEach(s=>{x.fillRect(s.x*S+1,s.y*S+1,S-2,S-2);});x.fillStyle='#FF6B35';x.fillRect(food.x*S+1,food.y*S+1,S-2,S-2);}
function tick(){if(!alive)return;const h={x:sn[0].x+d.x,y:sn[0].y+d.y};if(h.x<0||h.x>=W||h.y<0||h.y>=H||sn.some(s=>s.x===h.x&&s.y===h.y)){alive=false;setTimeout(()=>{sn=[{x:10,y:10}];d={x:1,y:0};score=0;alive=true;document.getElementById('sc').textContent=0;},1000);return;}sn.unshift(h);if(h.x===food.x&&h.y===food.y){score+=10;document.getElementById('sc').textContent=score;food={x:Math.floor(Math.random()*W),y:Math.floor(Math.random()*H)};}else sn.pop();draw();}
document.addEventListener('keydown',e=>{if(e.key==='ArrowUp'&&d.y!==1)d={x:0,y:-1};if(e.key==='ArrowDown'&&d.y!==-1)d={x:0,y:1};if(e.key==='ArrowLeft'&&d.x!==1)d={x:-1,y:0};if(e.key==='ArrowRight'&&d.x!==-1)d={x:1,y:0};});
let tx=0,ty=0;c.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;});
c.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;if(Math.abs(dx)>Math.abs(dy)){if(dx>0&&d.x!==-1)d={x:1,y:0};else if(dx<0&&d.x!==1)d={x:-1,y:0};}else{if(dy>0&&d.y!==-1)d={x:0,y:1};else if(dy<0&&d.y!==1)d={x:0,y:-1};}});
setInterval(tick,120);draw();
</script></body></html>`;

// ── MEMORY ──
const memory = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:12px;}
.grid{display:grid;grid-template-columns:repeat(4,60px);gap:8px;}
.card{width:60px;height:60px;background:#1a1a2e;border:1px solid #2a2a3e;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;transition:all .2s;}
.card.flip{background:#0a2a1a;border-color:#00FFA3;}
.card.done{background:#0a2a1a;border-color:#00FFA355;opacity:.6;}
</style></head><body>
<div style="font-size:12px;color:#00FFA3;font-family:monospace;">MEMORY MATCH</div>
<div class="grid" id="g"></div>
<div class="score" style="position:static;margin-top:8px;" id="sc">Pairs: 0/8</div>
<script>
const emojis=['🎮','🚀','💎','🎵','⚡','🧠','🎨','🔥'];
const cards=[...emojis,...emojis].sort(()=>Math.random()-.5);
let flipped=[],matched=0,lock=false;
const g=document.getElementById('g');
cards.forEach((e,i)=>{const d=document.createElement('div');d.className='card';d.dataset.i=i;d.dataset.e=e;d.textContent='?';d.onclick=()=>flip(d);g.appendChild(d);});
function flip(d){if(lock||d.classList.contains('flip')||d.classList.contains('done'))return;d.textContent=d.dataset.e;d.classList.add('flip');flipped.push(d);if(flipped.length===2){lock=true;const[a,b]=flipped;if(a.dataset.e===b.dataset.e){a.classList.add('done');b.classList.add('done');matched++;document.getElementById('sc').textContent='Pairs: '+matched+'/8';flipped=[];lock=false;if(matched===8)setTimeout(()=>{g.querySelectorAll('.card').forEach(c=>{c.classList.remove('flip','done');c.textContent='?';});cards.sort(()=>Math.random()-.5);g.querySelectorAll('.card').forEach((c,i)=>{c.dataset.e=cards[i];});matched=0;document.getElementById('sc').textContent='Pairs: 0/8';},1500);}else{setTimeout(()=>{a.textContent='?';b.textContent='?';a.classList.remove('flip');b.classList.remove('flip');flipped=[];lock=false;},800);}}}
</script></body></html>`;

// ── 2048 ──
const game2048 = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:10px;}
.board{display:grid;grid-template-columns:repeat(4,65px);gap:6px;padding:10px;background:#0d0d25;border-radius:10px;}
.tile{width:65px;height:65px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-weight:bold;font-size:18px;font-family:monospace;background:#1a1a2e;color:#F0F0FF;transition:all .15s;}
</style></head><body>
<div style="font-size:12px;color:#00FFA3;font-family:monospace;">2048</div>
<div class="board" id="b"></div>
<div id="sc" style="font-size:13px;color:#00FFA3;font-family:monospace;">Score: 0</div>
<script>
let grid=Array.from({length:4},()=>Array(4).fill(0)),score=0;
const colors={2:'#1a2a2e',4:'#1a3a2e',8:'#0a3a2a',16:'#0a4a2a',32:'#00FFA3',64:'#00cc82',128:'#7B61FF',256:'#6B51EF',512:'#5B41DF',1024:'#FF6B35',2048:'#FBBF24'};
function spawn(){const e=[];grid.forEach((r,y)=>r.forEach((v,x)=>{if(!v)e.push({x,y});}));if(e.length){const p=e[Math.floor(Math.random()*e.length)];grid[p.y][p.x]=Math.random()<.9?2:4;}}
function draw(){const b=document.getElementById('b');b.innerHTML='';grid.forEach(r=>r.forEach(v=>{const d=document.createElement('div');d.className='tile';if(v){d.textContent=v;d.style.background=colors[v]||'#FBBF24';if(v>=32)d.style.color='#07071A';}b.appendChild(d);}));document.getElementById('sc').textContent='Score: '+score;}
function slide(row){let r=row.filter(v=>v);for(let i=0;i<r.length-1;i++){if(r[i]===r[i+1]){r[i]*=2;score+=r[i];r.splice(i+1,1);}}while(r.length<4)r.push(0);return r;}
function move(dir){let moved=false;const g=JSON.stringify(grid);if(dir==='left')grid=grid.map(r=>slide(r));else if(dir==='right')grid=grid.map(r=>slide([...r].reverse()).reverse());else if(dir==='up'){for(let x=0;x<4;x++){let col=grid.map(r=>r[x]);col=slide(col);col.forEach((v,y)=>grid[y][x]=v);}}else{for(let x=0;x<4;x++){let col=grid.map(r=>r[x]).reverse();col=slide(col).reverse();col.forEach((v,y)=>grid[y][x]=v);}}if(JSON.stringify(grid)!==g){spawn();moved=true;}draw();}
document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')move('left');if(e.key==='ArrowRight')move('right');if(e.key==='ArrowUp')move('up');if(e.key==='ArrowDown')move('down');});
let sx=0,sy=0;document.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;});
document.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>Math.abs(dy)){move(dx>0?'right':'left');}else if(Math.abs(dy)>20){move(dy>0?'down':'up');}});
spawn();spawn();draw();
</script></body></html>`;

// ── PONG ──
const pong = `<!DOCTYPE html><html><head><style>${DUM_STYLE}</style></head><body>
<div class="info">PONG</div><div class="score" id="sc">0 - 0</div>
<canvas id="c" width="300" height="200"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');
let p1=80,p2=80,bx=150,by=100,bdx=2.5,bdy=1.5,s1=0,s2=0;
const PH=40,PW=6;
function draw(){x.fillStyle='#07071A';x.fillRect(0,0,300,200);x.setLineDash([4,4]);x.strokeStyle='#1a1a2e';x.beginPath();x.moveTo(150,0);x.lineTo(150,200);x.stroke();x.setLineDash([]);x.fillStyle='#00FFA3';x.fillRect(8,p1,PW,PH);x.fillStyle='#7B61FF';x.fillRect(286,p2,PW,PH);x.beginPath();x.arc(bx,by,5,0,Math.PI*2);x.fillStyle='#fff';x.fill();document.getElementById('sc').textContent=s1+' - '+s2;}
function tick(){bx+=bdx;by+=bdy;if(by<=5||by>=195)bdy*=-1;if(bx<=14&&by>=p1&&by<=p1+PH){bdx=Math.abs(bdx);bdy+=(by-(p1+PH/2))*.1;}if(bx>=286&&by>=p2&&by<=p2+PH){bdx=-Math.abs(bdx);bdy+=(by-(p2+PH/2))*.1;}if(bx<0){s2++;bx=150;by=100;bdx=2.5;bdy=1.5;}if(bx>300){s1++;bx=150;by=100;bdx=-2.5;bdy=-1.5;}p2+=(by-p2-PH/2)*.06;draw();}
document.addEventListener('keydown',e=>{if(e.key==='ArrowUp')p1=Math.max(0,p1-15);if(e.key==='ArrowDown')p1=Math.min(160,p1+15);});
c.addEventListener('touchmove',e=>{e.preventDefault();const r=c.getBoundingClientRect();p1=Math.max(0,Math.min(160,e.touches[0].clientY-r.top-PH/2));},{passive:false});
setInterval(tick,16);draw();
</script></body></html>`;

// ── CALCULATOR ──
const calculator = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:8px;}
.display{width:240px;padding:12px;background:#0d0d25;border:1px solid #1a1a2e;border-radius:10px;text-align:right;font-size:24px;font-family:monospace;color:#00FFA3;min-height:48px;word-break:break-all;}
.keys{display:grid;grid-template-columns:repeat(4,56px);gap:6px;}
.key{width:56px;height:44px;border:1px solid #1a1a2e;border-radius:8px;background:#0d0d25;color:#F0F0FF;font-size:16px;font-family:monospace;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.key:hover{background:#1a1a2e;}
.key.op{color:#00FFA3;border-color:#00FFA344;}
.key.eq{background:#00FFA3;color:#07071A;border:none;font-weight:bold;}
.key.cl{color:#FF6B35;}
</style></head><body>
<div style="font-size:11px;color:#555;font-family:monospace;">CALCULATOR</div>
<div class="display" id="d">0</div>
<div class="keys" id="k"></div>
<script>
const keys=['C','±','%','÷','7','8','9','×','4','5','6','-','1','2','3','+','0','.','⌫','='];
const ops={'+':true,'-':true,'×':true,'÷':true};
let cur='0',prev='',op='';
const d=document.getElementById('d'),k=document.getElementById('k');
keys.forEach(key=>{const b=document.createElement('div');b.className='key'+(ops[key]?' op':'')+(key==='='?' eq':'')+(key==='C'||key==='±'||key==='%'?' cl':'');b.textContent=key;b.onclick=()=>press(key);k.appendChild(b);});
function press(key){if(key==='C'){cur='0';prev='';op='';} else if(key==='⌫'){cur=cur.length>1?cur.slice(0,-1):'0';} else if(key==='±'){cur=String(-parseFloat(cur));} else if(key==='%'){cur=String(parseFloat(cur)/100);} else if(ops[key]){prev=cur;op=key;cur='0';} else if(key==='='){const a=parseFloat(prev),b=parseFloat(cur);if(op==='+'||op==='-'||op==='×'||op==='÷'){cur=String(op==='+'?a+b:op==='-'?a-b:op==='×'?a*b:b!==0?a/b:'Error');}prev='';op='';} else if(key==='.'){if(!cur.includes('.'))cur+='.';} else{cur=cur==='0'?key:cur+key;}d.textContent=cur;}
</script></body></html>`;

// ── TIMER ──
const timer = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:16px;}
.time{font-family:monospace;font-size:48px;color:#00FFA3;text-shadow:0 0 20px rgba(0,255,163,.3);}
.btns{display:flex;gap:10px;}
</style></head><body>
<div style="font-size:11px;color:#555;font-family:monospace;">STOPWATCH</div>
<div class="time" id="t">00:00.00</div>
<div class="btns">
<button id="ss" onclick="toggle()">Start</button>
<button onclick="reset()" style="background:#1a1a2e;color:#F0F0FF;">Reset</button>
</div>
<script>
let ms=0,running=false,iv;
function fmt(ms){const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),cs=Math.floor((ms%1000)/10);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0');}
function toggle(){running=!running;document.getElementById('ss').textContent=running?'Pause':'Start';if(running){const st=Date.now()-ms;iv=setInterval(()=>{ms=Date.now()-st;document.getElementById('t').textContent=fmt(ms);},10);}else clearInterval(iv);}
function reset(){running=false;clearInterval(iv);ms=0;document.getElementById('t').textContent='00:00.00';document.getElementById('ss').textContent='Start';}
</script></body></html>`;

// ── QUIZ ──
const quiz = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:12px;padding:20px;align-items:stretch;max-width:320px;margin:0 auto;}
.q{font-size:16px;color:#F0F0FF;text-align:center;min-height:48px;display:flex;align-items:center;justify-content:center;}
.opts{display:flex;flex-direction:column;gap:8px;}
.opt{padding:10px;border:1px solid #1a1a2e;border-radius:8px;background:#0d0d25;color:#F0F0FF;cursor:pointer;text-align:center;font-size:13px;transition:all .2s;}
.opt:hover{border-color:#00FFA3;background:#0a2a1a;}
.opt.correct{border-color:#00FFA3;background:#0a3a1a;color:#00FFA3;}
.opt.wrong{border-color:#FF6B35;background:#2a0a0a;color:#FF6B35;}
</style></head><body>
<div style="font-size:11px;color:#555;font-family:monospace;text-align:center;">QUIZ</div>
<div class="q" id="q"></div>
<div class="opts" id="opts"></div>
<div style="text-align:center;font-family:monospace;font-size:13px;color:#00FFA3;" id="sc">0 / 0</div>
<script>
const qs=[
{q:"What planet is closest to the Sun?",a:["Mercury","Venus","Earth","Mars"],c:0},
{q:"What is the largest ocean?",a:["Atlantic","Indian","Pacific","Arctic"],c:2},
{q:"How many continents are there?",a:["5","6","7","8"],c:2},
{q:"What gas do plants absorb?",a:["Oxygen","Nitrogen","CO2","Helium"],c:2},
{q:"What is H2O commonly known as?",a:["Salt","Water","Sugar","Oil"],c:1},
];
let qi=0,score=0,total=0,lock=false;
function show(){const q=qs[qi];document.getElementById('q').textContent=q.q;const o=document.getElementById('opts');o.innerHTML='';q.a.forEach((a,i)=>{const d=document.createElement('div');d.className='opt';d.textContent=a;d.onclick=()=>answer(i);o.appendChild(d);});lock=false;}
function answer(i){if(lock)return;lock=true;total++;const opts=document.getElementById('opts').children;if(i===qs[qi].c){opts[i].classList.add('correct');score++;}else{opts[i].classList.add('wrong');opts[qs[qi].c].classList.add('correct');}document.getElementById('sc').textContent=score+' / '+total;setTimeout(()=>{qi=(qi+1)%qs.length;show();},1200);}
show();
</script></body></html>`;

// ── EXPORTS ──

// ── TARGET (Aim Shooter) ──
const target = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:8px;cursor:crosshair;}
.hud{position:absolute;top:10px;width:100%;display:flex;justify-content:space-between;padding:0 16px;font-family:monospace;font-size:13px;}
.target{position:absolute;width:40px;height:40px;border-radius:50%;border:2px solid #00FFA3;display:flex;align-items:center;justify-content:center;cursor:crosshair;transition:transform .1s;}
.target::after{content:'';width:10px;height:10px;border-radius:50%;background:#00FFA3;}
.hit{animation:hitAnim .3s both;}
@keyframes hitAnim{0%{transform:scale(1);opacity:1}100%{transform:scale(2);opacity:0}}
</style></head><body>
<div class="hud"><span id="sc" style="color:#00FFA3">Score: 0</span><span id="acc" style="color:#7B61FF">Accuracy: 100%</span><span id="tm" style="color:#F0F0FF">30s</span></div>
<div id="area" style="position:relative;width:100%;height:100%;"></div>
<script>
const area=document.getElementById('area');let score=0,shots=0,hits=0,timeLeft=30,iv;
function spawn(){const t=document.createElement('div');t.className='target';const sz=30+Math.random()*30;t.style.width=t.style.height=sz+'px';t.style.left=Math.random()*(area.offsetWidth-sz)+'px';t.style.top=(40+Math.random()*(area.offsetHeight-sz-40))+'px';t.onclick=e=>{e.stopPropagation();hits++;score+=10;t.classList.add('hit');setTimeout(()=>t.remove(),300);update();};area.appendChild(t);setTimeout(()=>{if(t.parentNode)t.remove();},2000);}
function update(){document.getElementById('sc').textContent='Score: '+score;document.getElementById('acc').textContent='Accuracy: '+(shots?Math.round(hits/shots*100):100)+'%';}
area.onclick=()=>{shots++;update();};
function tick(){timeLeft--;document.getElementById('tm').textContent=timeLeft+'s';if(timeLeft<=0){clearInterval(iv);clearInterval(si);area.innerHTML='<div style="text-align:center;margin-top:30vh;"><div style="font-size:28px;font-weight:bold;color:#00FFA3;">'+score+'</div><div style="color:#555;font-size:13px;margin-top:8px;">Final Score</div><div style="color:#7B61FF;font-size:12px;margin-top:4px;">Accuracy: '+Math.round(hits/Math.max(shots,1)*100)+'%</div></div>';}}
iv=setInterval(tick,1000);const si=setInterval(spawn,800);spawn();
</script></body></html>`;

// ── TOPDOWN (Zombie Shooter) ──
const topdown = `<!DOCTYPE html><html><head><style>${DUM_STYLE}</style></head><body>
<div class="info">ZOMBIE ARENA</div><div class="score" id="sc">0</div>
<canvas id="c" width="320" height="320"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');
let px=160,py=160,mx=160,my=160,bullets=[],enemies=[],score=0,hp=3,alive=true,spawnT=0;
const speed=2.5,bSpeed=5,eSpeed=1;
const keys={};
document.addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true);
document.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
c.addEventListener('mousemove',e=>{const r=c.getBoundingClientRect();mx=e.clientX-r.left;my=e.clientY-r.top;});
c.addEventListener('click',()=>{if(!alive)return;const a=Math.atan2(my-py,mx-px);bullets.push({x:px,y:py,vx:Math.cos(a)*bSpeed,vy:Math.sin(a)*bSpeed});});
c.addEventListener('touchstart',e=>{if(!alive)return;const r=c.getBoundingClientRect();const tx=e.touches[0].clientX-r.left,ty=e.touches[0].clientY-r.top;const a=Math.atan2(ty-py,tx-px);bullets.push({x:px,y:py,vx:Math.cos(a)*bSpeed,vy:Math.sin(a)*bSpeed});});
function spawn(){const side=Math.floor(Math.random()*4);let ex,ey;if(side===0){ex=Math.random()*320;ey=-10;}else if(side===1){ex=330;ey=Math.random()*320;}else if(side===2){ex=Math.random()*320;ey=330;}else{ex=-10;ey=Math.random()*320;}enemies.push({x:ex,y:ey,hp:1});}
function tick(){if(!alive)return;if(keys.w||keys.arrowup)py=Math.max(8,py-speed);if(keys.s||keys.arrowdown)py=Math.min(312,py+speed);if(keys.a||keys.arrowleft)px=Math.max(8,px-speed);if(keys.d||keys.arrowright)px=Math.min(312,px+speed);
spawnT++;if(spawnT%40===0)spawn();
bullets=bullets.filter(b=>{b.x+=b.vx;b.y+=b.vy;return b.x>0&&b.x<320&&b.y>0&&b.y<320;});
enemies.forEach(e=>{const a=Math.atan2(py-e.y,px-e.x);e.x+=Math.cos(a)*eSpeed;e.y+=Math.sin(a)*eSpeed;});
bullets.forEach(b=>{enemies.forEach(e=>{if(Math.hypot(b.x-e.x,b.y-e.y)<12){e.hp--;b.x=-99;if(e.hp<=0){score+=10;e.x=-99;}}});});
enemies=enemies.filter(e=>e.x>-20);
enemies.forEach(e=>{if(Math.hypot(e.x-px,e.y-py)<14){hp--;e.x=-99;if(hp<=0){alive=false;setTimeout(()=>{alive=true;hp=3;score=0;enemies=[];bullets=[];px=py=160;},2000);}}});
document.getElementById('sc').textContent=score;
// Draw
x.fillStyle='#07071A';x.fillRect(0,0,320,320);
x.fillStyle='#00FFA3';x.beginPath();x.arc(px,py,8,0,Math.PI*2);x.fill();
x.fillStyle='#00FFA3';bullets.forEach(b=>{x.beginPath();x.arc(b.x,b.y,3,0,Math.PI*2);x.fill();});
x.fillStyle='#FF4444';enemies.forEach(e=>{x.beginPath();x.arc(e.x,e.y,8,0,Math.PI*2);x.fill();});
for(let i=0;i<3;i++){x.fillStyle=i<hp?'#FF4A6A':'#1A1A30';x.font='14px serif';x.fillText('♥',8+i*18,18);}
if(!alive){x.fillStyle='rgba(7,7,26,0.8)';x.fillRect(0,0,320,320);x.fillStyle='#FF4444';x.font='bold 16px monospace';x.textAlign='center';x.fillText('DEFEATED',160,150);x.fillStyle='#00FFA3';x.font='bold 24px monospace';x.fillText(score.toString(),160,180);}}
setInterval(tick,16);
</script></body></html>`;

// ── DEFENSE (Tower Defense) ──
const defense = `<!DOCTYPE html><html><head><style>${DUM_STYLE}
body{flex-direction:column;gap:4px;}
.board{display:grid;grid-template-columns:repeat(8,36px);gap:2px;}
.cell{width:36px;height:36px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;transition:all .15s;}
.path{background:#0d0d25;border:1px solid #1a1a2e;}
.grass{background:#0a1a0a;border:1px solid #1a2a1a;}
.tower{background:#0a2a1a;border:1px solid #00FFA3;}
.enemy{background:#2a0a0a;border:1px solid #FF4444;}
.hud{display:flex;gap:16px;font-family:monospace;font-size:12px;}
</style></head><body>
<div style="font-size:11px;color:#00FFA3;font-family:monospace;">TOWER DEFENSE</div>
<div class="hud"><span style="color:#00FFA3" id="gold">Gold: 100</span><span style="color:#FF4A6A" id="lives">Lives: 10</span><span style="color:#7B61FF" id="wave">Wave: 1</span></div>
<div class="board" id="b"></div>
<div style="font-size:9px;color:#555;font-family:monospace;margin-top:4px;">Click grass to place turret (20 gold)</div>
<script>
const P=[[0,0],[1,0],[2,0],[2,1],[2,2],[3,2],[4,2],[4,3],[4,4],[5,4],[6,4],[7,4]];
const pathSet=new Set(P.map(p=>p[0]+','+p[1]));
let gold=100,lives=10,wave=1,enemies=[],towers=[],tick=0;
const b=document.getElementById('b');
const cells=[];
for(let y=0;y<8;y++)for(let lx=0;lx<8;lx++){const d=document.createElement('div');const isP=pathSet.has(lx+','+y);d.className='cell '+(isP?'path':'grass');d.dataset.x=String(lx);d.dataset.y=String(y);if(!isP)d.onclick=()=>placeTower(lx,y,d);b.appendChild(d);cells.push({el:d,x:lx,y:y,isPath:isP,hasTower:false});}
function placeTower(tx,ty,el){if(gold<20)return;const c=cells.find(c=>c.x===tx&&c.y===ty);if(!c||c.isPath||c.hasTower)return;gold-=20;c.hasTower=true;c.el.className='cell tower';c.el.textContent='🔫';towers.push({x:tx,y:ty,range:2,dmg:1,cooldown:0});}
function spawnWave(){for(let i=0;i<wave*2+3;i++){enemies.push({pi:0,hp:wave+1,maxHp:wave+1,off:-(i*15)});}}
function update(){tick++;
enemies.forEach(e=>{e.off++;if(e.off<0)return;const pi=Math.floor(e.off/15);if(pi>=P.length){lives--;e.hp=0;return;}e.pi=pi;});
enemies=enemies.filter(e=>e.hp>0);
towers.forEach(t=>{t.cooldown--;if(t.cooldown>0)return;const target=enemies.find(e=>e.off>=0&&e.pi<P.length&&Math.hypot(P[e.pi][0]-t.x,P[e.pi][1]-t.y)<=t.range);if(target){target.hp-=t.dmg;t.cooldown=20;if(target.hp<=0){gold+=5;}}});
enemies=enemies.filter(e=>e.hp>0);
if(enemies.length===0&&tick>60){wave++;spawnWave();}
// Render enemies on path
cells.forEach(c=>{if(c.isPath)c.el.textContent='';if(c.hasTower)return;});
enemies.forEach(e=>{if(e.off<0||e.pi>=P.length)return;const[ex,ey]=P[e.pi];const c=cells.find(c=>c.x===ex&&c.y===ey);if(c)c.el.textContent='👾';});
document.getElementById('gold').textContent='Gold: '+gold;
document.getElementById('lives').textContent='Lives: '+lives;
document.getElementById('wave').textContent='Wave: '+wave;
if(lives<=0){lives=10;gold=100;wave=1;enemies=[];towers=[];cells.forEach(c=>{c.hasTower=false;c.el.className='cell '+(c.isPath?'path':'grass');c.el.textContent='';});}}
spawnWave();setInterval(update,50);
</script></body></html>`;

export const TEMPLATES: Record<string, { html: string; label: string; emoji: string }> = {
  tetris: { html: tetris, label: "Tetris", emoji: "🧱" },
  snake: { html: snake, label: "Snake", emoji: "🐍" },
  memory: { html: memory, label: "Memory Match", emoji: "🃏" },
  "2048": { html: game2048, label: "2048", emoji: "🔢" },
  pong: { html: pong, label: "Pong", emoji: "🏓" },
  calculator: { html: calculator, label: "Calculator", emoji: "🔢" },
  timer: { html: timer, label: "Stopwatch", emoji: "⏱️" },
  quiz: { html: quiz, label: "Quiz", emoji: "❓" },
  target: { html: target, label: "Target Shooter", emoji: "🎯" },
  topdown: { html: topdown, label: "Zombie Arena", emoji: "🧟" },
  defense: { html: defense, label: "Tower Defense", emoji: "🏰" },
};

export function matchTemplate(idea: string): string | null {
  const t = idea.toLowerCase();
  const keywords: Record<string, string[]> = {
    tetris: ["tetris", "block stack", "falling block", "brick game", "block game", "block puzzle"],
    snake: ["snake", "slither"],
    memory: ["memory game", "memory match", "card match", "matching game", "card game", "flip card"],
    "2048": ["2048", "number tile", "tile merge", "sliding number", "number merge"],
    pong: ["pong", "paddle", "ping pong", "table tennis"],
    calculator: ["calculator", "calc"],
    timer: ["timer", "stopwatch", "countdown", "time tracker"],
    quiz: ["quiz", "trivia", "question game", "knowledge test"],
    target: ["target", "aim", "sniper", "shoot target", "target practice", "aim trainer"],
    topdown: ["zombie", "survival game", "top down shoot", "arena shoot", "zombie shoot", "shooting game", "shooter game", "shoot em"],
    defense: ["tower defense", "defend", "base defense", "turret"],
  };
  for (const [id, kws] of Object.entries(keywords)) {
    if (kws.some((kw) => t.includes(kw))) return id;
  }
  return null;
}

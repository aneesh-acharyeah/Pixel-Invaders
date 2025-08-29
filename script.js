(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Scale canvas for device pixel ratio
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize(){
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = w+'px';
    canvas.style.height = h+'px';
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
  }
  addEventListener('resize', resize, {passive:true});
  resize();

  // UI elements
  const startUI = document.getElementById('start');
  const overUI = document.getElementById('over');
  const playBtn = document.getElementById('playBtn');
  const howBtn = document.getElementById('howBtn');
  const ghBtn = document.getElementById('ghBtn');
  const againBtn = document.getElementById('againBtn');
  const shareBtn = document.getElementById('shareBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const finalScoreEl = document.getElementById('finalScore');
  const finalBestEl = document.getElementById('finalBest');

  // Persistent best score
  const BEST_KEY = 'neon_dodger_best_v1';
  let BEST = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = BEST;

  // Game state
  let running = false;
  let paused = false;
  let time = 0;           // ms
  let last = 0;           // timestamp
  let score = 0;

  // World
  const world = {
    gravity: 2200,         // px/s^2
    floor: () => canvas.height - 120 * DPR,
    lanes: () => [0.24, 0.5, 0.76].map(p => Math.floor(canvas.width * p)), // lane x positions
    speed: 260,            // base px/s
  };

  // Player
  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    size: 26, lane: 1, onGround: true,
    color1: '#56ccf2', color2: '#a86af9',
  };

  function resetPlayer(){
    const lanes = world.lanes();
    player.lane = 1;
    player.x = lanes[player.lane];
    player.y = world.floor() - 60 * DPR;
    player.vx = 0; player.vy = 0; player.onGround = true;
  }

  // Obstacles
  const obstacles = [];
  function spawnObstacle(){
    const lanes = world.lanes();
    const lane = Math.floor(Math.random()*3);
    const type = Math.random() < 0.55 ? 'bar' : 'gate';
    const w = (type==='bar'? 38: 22) * DPR;
    const h = (type==='bar'? 80: 150) * DPR;
    const gap = 28 * DPR;
    obstacles.push({
      type,
      x: canvas.width + w + 60*DPR,
      y: world.floor() - (type==='bar'? h : h + gap),
      w, h, lane,
      passed:false,
    });
  }

  // Particles for flair
  const particles = [];
  function addParticles(x,y,n=10){
    for(let i=0;i<n;i++){
      particles.push({
        x, y,
        vx:(Math.random()*2-1)*120*DPR,
        vy:(Math.random()*-1)*220*DPR,
        life: 420 + Math.random()*380,
      });
    }
  }

  // Input
  const keys = new Set();
  addEventListener('keydown', e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','Space','KeyP','KeyR'].includes(e.code)) e.preventDefault();
    if(e.code==='KeyP') togglePause();
    else if(e.code==='KeyR') restart();
    keys.add(e.code);
  });
  addEventListener('keyup', e=> keys.delete(e.code));

  // Touch: left/right sides dash, top third jump
  addEventListener('touchstart', e=>{
    if(!running){ start(); return; }
    const t = e.touches[0];
    const x = t.clientX, y=t.clientY;
    if(y < innerHeight*0.42) jump();
    else if(x < innerWidth*0.5) dash(-1);
    else dash(1);
  }, {passive:true});

  function dash(dir){
    const lanes = world.lanes();
    player.lane = Math.max(0, Math.min(2, player.lane + (dir<0?-1:1)));
    const targetX = lanes[player.lane];
    player.vx = (targetX - player.x) * 7; // smooth lerp
    addParticles(player.x, player.y, 6);
  }

  function jump(){
    if(player.onGround){
      player.vy = -820 * DPR; // impulse
      player.onGround = false;
    }
  }

  function togglePause(){
    if(!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? '▶️ Resume' : '⏸️ Pause';
    if(!paused){
      last = performance.now();
      loop(last);
    }
  }

  function start(){
    startUI.style.display='none';
    overUI.style.display='none';
    running = true; paused = false; score = 0; time = 0; last = performance.now();
    obstacles.length = 0; particles.length = 0; spawnTimer = 0; difficulty = 0;
    resetPlayer();
    loop(last);
  }

  function gameOver(){
    running = false;
    overUI.style.display='grid';
    finalScoreEl.textContent = Math.floor(score);
    BEST = Math.max(BEST, Math.floor(score));
    localStorage.setItem(BEST_KEY, BEST);
    bestEl.textContent = BEST;
    finalBestEl.textContent = BEST;
  }

  function restart(){
    if(!running){ start(); }
    else { // quick restart
      running=false; start();
    }
  }

  playBtn.onclick = start;
  againBtn.onclick = start;
  howBtn.onclick = ()=> alert('Controls:\n• Left / Right → Dash between lanes\n• Up Arrow or Space → Jump\n• P → Pause\n• R → Restart\n\nTip: Gates require a jump, Bars require shifting lanes. The speed ramps up the longer you survive. Good luck!');
  ghBtn.onclick = ()=> alert('To add to GitHub: Create a new repo, add this single HTML file, push, and enable GitHub Pages to play it online!');
  shareBtn.onclick = ()=>{
    const txt = `I scored ${Math.floor(score)} in Neon Dodger!`;
    if(navigator.share){ navigator.share({title:'Neon Dodger', text:txt, url:location.href}).catch(()=>{}); }
    else { navigator.clipboard.writeText(txt).then(()=>alert('Copied to clipboard!')); }
  };
  pauseBtn.onclick = togglePause;
  restartBtn.onclick = restart;

  // Main loop vars
  let spawnTimer = 0;
  let difficulty = 0; // increases over time

  function loop(ts){
    if(!running) return;
    if(paused) return;

    const dt = Math.min(32, ts - last); // clamp 32ms
    last = ts; time += dt;

    update(dt/1000);
    draw();

    requestAnimationFrame(loop);
  }

  function update(dt){
    // Increase difficulty: speeds up to ~2x and faster spawns
    difficulty += dt*0.06;

    // Move player towards target lane
    player.x += player.vx * dt;
    player.vx *= 0.86; // damping

    // Gravity
    player.vy += world.gravity * dt;
    player.y += player.vy * dt;

    const floorY = world.floor();
    if(player.y > floorY - 60*DPR){
      player.y = floorY - 60*DPR; player.vy = 0; player.onGround = true;
    }

    // Keyboard input
    if(keys.has('ArrowLeft')) dash(-1);
    if(keys.has('ArrowRight')) dash(1);
    if(keys.has('ArrowUp') || keys.has('Space')) { jump(); keys.delete('Space'); keys.delete('ArrowUp'); }

    // Spawn obstacles
    spawnTimer -= dt;
    const baseInterval = 1.15; // seconds
    const interval = Math.max(0.45, baseInterval - difficulty*0.45);
    if(spawnTimer <= 0){
      spawnObstacle();
      spawnTimer = interval * (0.75 + Math.random()*0.5);
    }

    // Move obstacles
    const speed = (world.speed + difficulty*260) * DPR; // px/s
    for(const o of obstacles){
      o.x -= speed * dt;
      // mark passed
      if(!o.passed && o.x + o.w < player.x){ o.passed = true; score += 1; }
    }
    // Remove off-screen
    for(let i=obstacles.length-1;i>=0;i--){ if(obstacles[i].x + obstacles[i].w < -60*DPR) obstacles.splice(i,1); }

    // Particles update
    for(const p of particles){
      p.life -= dt*1000;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900*DPR * dt;
    }
    for(let i=particles.length-1;i>=0;i--){ if(particles[i].life<=0) particles.splice(i,1); }

    // Collisions
    const px = player.x, py = player.y, ps = player.size*DPR;
    for(const o of obstacles){
      const ox = o.x, oy = o.y, ow = o.w, oh = o.h;
      const hit = px-ps/2 < ox+ow && px+ps/2 > ox && py-ps/2 < oy+oh && py+ps/2 > oy;
      if(hit){
        addParticles(px, py, 24);
        gameOver();
        break;
      }
    }

    // Score
    scoreEl.textContent = Math.floor(score);
  }

  function drawGrid(){
    const w = canvas.width, h = canvas.height;
    ctx.save();
    for(let i=0;i<20;i++){
      const y = Math.floor(h*(i/20));
      ctx.strokeStyle = `rgba(168,106,249,${0.03 + i*0.002})`;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
    const lanes = world.lanes();
    lanes.forEach(x=>{
      ctx.strokeStyle = 'rgba(86,204,242,.06)';
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    });
    ctx.restore();
  }

  function glowRect(x,y,w,h,primary,secondary){
    const r = 10*DPR;
    // outer glow
    const g = ctx.createLinearGradient(x,y,x+w,y+h);
    g.addColorStop(0, primary);
    g.addColorStop(1, secondary);
    ctx.shadowBlur = 20*DPR;
    ctx.shadowColor = primary;
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, r); ctx.fill();
  }

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function draw(){
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);

    // background vignette
    const bg = ctx.createRadialGradient(w*0.15,h*0.15,40*DPR, w*0.5,h*0.6, Math.max(w,h));
    bg.addColorStop(0,'#0f1a3a');
    bg.addColorStop(1,'#0b1020');
    ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);

    drawGrid();

    // floor line
    ctx.strokeStyle = 'rgba(56,239,125,.25)';
    ctx.beginPath(); ctx.moveTo(0, world.floor()+2*DPR); ctx.lineTo(w, world.floor()+2*DPR); ctx.stroke();

    // obstacles
    for(const o of obstacles){
      if(o.type==='bar') glowRect(o.x, o.y, o.w, o.h, '#ff5c8a', '#a86af9');
      else glowRect(o.x, o.y, o.w, o.h, '#38ef7d', '#56ccf2');
    }

    // player
    const ps = player.size*DPR;
    glowRect(player.x-ps/2, player.y-ps/2, ps, ps, player.color1, player.color2);

    // trail particles
    for(const p of particles){
      const alpha = Math.max(0, p.life/800);
      ctx.fillStyle = `rgba(86,204,242,${alpha})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,3.5*DPR,0,Math.PI*2); ctx.fill();
    }
  }

  // Kick off idle draw so start screen has background
  draw();
})();

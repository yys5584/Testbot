import './style.css';
type UnitDef = { id: string, name: string, emoji: string, cost: number, dmg: number, aspd: number, color: string };
const UNIT_DB: UnitDef[] = [
  { id: '1', name: 'PC방 채굴자', emoji: '⛏️', cost: 1, dmg: 10, aspd: 1.0, color: '#A0522D' },
  { id: '2', name: '워뇨띠', emoji: '🥷', cost: 2, dmg: 25, aspd: 1.5, color: '#4dd8c0' },
  { id: '3', name: '도권', emoji: '💀', cost: 5, dmg: 120, aspd: 1.2, color: '#e74c3c' },
  { id: '4', name: '사토시', emoji: '🌟', cost: 10, dmg: 400, aspd: 3.0, color: '#f0b232' }
];
interface PlacedUnit extends UnitDef { x: number; y: number; cooldown: number; }
interface Projectile { sx: number; sy: number; tx: number; ty: number; color: string; life: number; thick: number; }
interface FloatText { x: number; y: number; text: string; color: string; life: number; }

const state = {
  gold: 50, bench: new Array<UnitDef | null>(9).fill(null), board: new Array<PlacedUnit | null>(28).fill(null),
  shop: new Array<UnitDef | null>(5).fill(null), selectedBenchIdx: -1,
  enemy: { x: 50, y: 150, hp: 1000, maxHp: 1000, speed: 120, hitFlash: 0 }, projectiles: [] as Projectile[], texts: [] as FloatText[]
};

const COLS = 7, ROWS = 4, CELL = 120;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const elGold = document.getElementById('player-gold')!;

function rollShop() {
  if (state.gold < 2) return; state.gold -= 2;
  state.shop = Array.from({ length: 5 }, () => {
    const r = Math.random();
    if (r < 0.05) return UNIT_DB[3]; if (r < 0.20) return UNIT_DB[2]; if (r < 0.50) return UNIT_DB[1]; return UNIT_DB[0];
  });
  state.selectedBenchIdx = -1;
  document.body.classList.add('shake'); setTimeout(() => document.body.classList.remove('shake'), 150);
  renderUI();
}

function buyUnit(idx: number) {
  const unit = state.shop[idx]; if (!unit || state.gold < unit.cost) return;
  const emptyIdx = state.bench.findIndex(u => u === null); if (emptyIdx === -1) return;
  state.gold -= unit.cost; state.shop[idx] = null; state.bench[emptyIdx] = { ...unit }; renderUI();
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / CELL); const row = Math.floor((e.clientY - rect.top) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const bIdx = row * COLS + col;
  if (state.selectedBenchIdx !== -1 && state.board[bIdx] === null) {
    state.board[bIdx] = { ...state.bench[state.selectedBenchIdx]!, x: col * CELL + CELL / 2, y: row * CELL + CELL / 2, cooldown: 0 };
    state.bench[state.selectedBenchIdx] = null; state.selectedBenchIdx = -1; renderUI();
  } else if (state.board[bIdx] !== null) {
    const unit = state.board[bIdx]!; state.gold += unit.cost; state.board[bIdx] = null;
    state.texts.push({ x: unit.x, y: unit.y, text: `+${unit.cost}G 소각`, color: '#f0b232', life: 1 }); renderUI();
  }
});

function renderUI() {
  elGold.innerText = state.gold.toString();
  document.getElementById('shop')!.innerHTML = state.shop.map((u, i) => u ? `<div class="shop-card" onclick="window.buyUnit(${i})"><div class="emoji">${u.emoji}</div><div class="name">${u.name}</div><div class="cost">🪙 ${u.cost}</div></div>` : `<div class="shop-card" style="opacity: 0.3"><div class="name">Sold Out</div></div>`).join('');
  document.getElementById('bench')!.innerHTML = state.bench.map((u, i) => `<div class="slot ${state.selectedBenchIdx === i ? 'selected' : ''}" onclick="window.selectBench(${i})">${u ? `<div class="emoji">${u.emoji}</div>` : ''}</div>`).join('');
}
(window as any).buyUnit = buyUnit; (window as any).selectBench = (i: number) => { state.selectedBenchIdx = state.selectedBenchIdx === i ? -1 : i; renderUI(); };
document.getElementById('btn-reroll')!.onclick = rollShop; window.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'd') rollShop(); });

let lastTime = performance.now();
function gameLoop(time: number) {
  const dt = (time - lastTime) / 1000; lastTime = time; ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 2;
  for (let i=0; i<=COLS; i++) { ctx.beginPath(); ctx.moveTo(i*CELL, 0); ctx.lineTo(i*CELL, canvas.height); ctx.stroke(); }
  for (let i=0; i<=ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i*CELL); ctx.lineTo(canvas.width, i*CELL); ctx.stroke(); }

  const enemy = state.enemy; enemy.x += enemy.speed * dt;
  if (enemy.x > canvas.width - 60 || enemy.x < 60) enemy.speed *= -1;
  if (enemy.hitFlash > 0) enemy.hitFlash -= dt;

  ctx.save(); ctx.font = '60px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (enemy.hitFlash > 0) ctx.filter = 'brightness(2) drop-shadow(0 0 15px white)';
  ctx.fillText('🐉', enemy.x, enemy.y); ctx.restore();
  ctx.fillStyle = '#333'; ctx.fillRect(enemy.x - 40, enemy.y - 50, 80, 10);
  ctx.fillStyle = '#e74c3c'; ctx.fillRect(enemy.x - 40, enemy.y - 50, 80 * (enemy.hp / enemy.maxHp), 10);

  state.board.forEach(unit => {
    if (!unit) return;
    ctx.font = '50px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(unit.emoji, unit.x, unit.y);
    unit.cooldown -= dt;
    if (unit.cooldown <= 0 && enemy.hp > 0 && Math.hypot(enemy.x - unit.x, enemy.y - unit.y) < 350) {
      unit.cooldown = 1 / unit.aspd;
      const isCrit = Math.random() < 0.2; const dmg = isCrit ? unit.dmg * 2 : unit.dmg;
      enemy.hp -= dmg; enemy.hitFlash = 0.05;
      const color = isCrit ? '#f0b232' : unit.color;
      state.projectiles.push({ sx: unit.x, sy: unit.y, tx: enemy.x, ty: enemy.y, color, life: 0.15, thick: isCrit ? 8 : 3 });
      state.texts.push({ x: enemy.x + (Math.random()*60-30), y: enemy.y - 20, text: isCrit ? `-${dmg} 💥` : `-${dmg}`, color, life: 1 });
      if (isCrit) { document.body.classList.add('shake'); setTimeout(() => document.body.classList.remove('shake'), 100); }
      if (enemy.hp <= 0) { state.gold += 15; enemy.maxHp = Math.floor(enemy.maxHp * 1.5); enemy.hp = enemy.maxHp; state.texts.push({ x: enemy.x, y: enemy.y - 60, text: '+15G (KILL)', color: '#4dd8c0', life: 1.5 }); renderUI(); }
    }
  });

  state.projectiles = state.projectiles.filter(p => p.life > 0);
  state.projectiles.forEach(p => { p.life -= dt; ctx.strokeStyle = p.color; ctx.lineWidth = p.thick; ctx.globalAlpha = p.life / 0.15; ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.tx, p.ty); ctx.stroke(); ctx.globalAlpha = 1.0; });
  state.texts = state.texts.filter(t => t.life > 0);
  state.texts.forEach(t => { t.life -= dt * 1.5; t.y -= 40 * dt; ctx.fillStyle = t.color; ctx.globalAlpha = Math.max(0, t.life); ctx.font = 'bold 24px NeoDunggeunmo'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText(t.text, t.x, t.y); ctx.fillText(t.text, t.x, t.y); ctx.globalAlpha = 1.0; });

  requestAnimationFrame(gameLoop);
}
rollShop(); requestAnimationFrame(gameLoop);

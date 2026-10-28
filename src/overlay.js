hydrateIcons();
const $ = id => document.getElementById(id);
const shot = $('shot'), dim = $('dim'), selEl = $('sel'), tag = $('tag'), bar = $('bar'), loupe = $('loupe'), lc = $('lc').getContext('2d');
let cfg = { scale: 1, w: innerWidth, h: innerHeight, cursor: true, audio: true, gif: false };
let sel = null;            // {x,y,w,h} theo DIP trong màn này
let drag = null;           // {mode,sx,sy,orig}
let img = null;

api.on('sel:init', c => {
  cfg = c;
  if (c.img) { shot.src = c.img; img = new Image(); img.src = c.img; }
  if (c.last) {
    sel = norm({ x: c.last.x, y: c.last.y, w: c.last.w, h: c.last.h });
    $('hint').innerHTML = 'Đang hiện <b>vùng lần trước</b> · <kbd>Enter</kbd> quay luôn · kéo chỗ khác để chọn vùng mới · <kbd>Esc</kbd> huỷ';
  }
  $('pLast').hidden = !c.last;
  sizeCanvas(); syncToggles(); draw();
  if (!c.cursorHere) $('hint').style.opacity = 0;
});
api.on('sel:clear', () => { sel = null; draw(); });

function sizeCanvas() { dim.width = innerWidth; dim.height = innerHeight; }
addEventListener('resize', () => { sizeCanvas(); draw(); });

function syncToggles() {
  const c = $('tCursor'), a = $('tAudio');
  c.className = 'ibtn ' + (cfg.cursor ? 'on' : 'off'); c.innerHTML = icon('cursor');
  c.title = cfg.cursor ? 'Đang quay kèm chuột · bấm để ẩn chuột' : 'Đang ẩn chuột · bấm để hiện chuột';
  a.className = 'ibtn ' + (cfg.audio && !cfg.gif ? 'on' : 'off'); a.innerHTML = icon(cfg.audio && !cfg.gif ? 'vol' : 'mute');
  a.disabled = cfg.gif;
  a.title = cfg.gif ? 'GIF không có âm thanh' : (cfg.audio ? 'Đang thu âm thanh máy · bấm để tắt' : 'Không thu âm thanh · bấm để bật');
}
$('tCursor').onclick = () => { cfg.cursor = !cfg.cursor; syncToggles(); };
$('tAudio').onclick = () => { cfg.audio = !cfg.audio; syncToggles(); };
$('cancel').onclick = () => api.send('sel:cancel');
$('go').onclick = confirm;
bar.querySelectorAll('[data-p]').forEach(b => b.onclick = () => preset(b.dataset.p));

function phys(v) { return Math.round(v * cfg.scale); }
function norm(r) {
  let { x, y, w, h } = r;
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(w, innerWidth - x); h = Math.min(h, innerHeight - y);
  return { x, y, w, h };
}

function draw() {
  const g = dim.getContext('2d');
  g.clearRect(0, 0, dim.width, dim.height);
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.fillRect(0, 0, dim.width, dim.height);
  if (!sel) { selEl.style.display = tag.style.display = bar.style.display = 'none'; return; }
  g.clearRect(sel.x, sel.y, sel.w, sel.h);
  Object.assign(selEl.style, { display: 'block', left: sel.x - 1 + 'px', top: sel.y - 1 + 'px', width: sel.w + 2 + 'px', height: sel.h + 2 + 'px' });
  tag.textContent = `${phys(sel.w)} × ${phys(sel.h)}`;
  tag.style.display = 'block';
  tag.style.left = sel.x + 'px';
  tag.style.top = (sel.y > 30 ? sel.y - 28 : sel.y + 6) + 'px';
  if (!drag) placeBar(); else bar.style.display = 'none';
}

function placeBar() {
  bar.style.display = 'flex';
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let x = Math.min(Math.max(4, sel.x), innerWidth - bw - 4);
  let y = sel.y + sel.h + 10;
  if (y + bh > innerHeight - 4) y = sel.y - bh - 36;
  if (y < 4) y = sel.y + sel.h - bh - 10;
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}

function preset(p) {
  if (p === 'last') { if (cfg.last) { sel = norm({ ...cfg.last }); draw(); } return; }
  let w, h;
  if (p === 'square') { const s = sel ? Math.min(sel.w, sel.h) : Math.min(innerWidth, innerHeight) * .6; w = h = s; }
  else { const [pw, ph] = p.split('x').map(Number); w = pw / cfg.scale; h = ph / cfg.scale; }
  w = Math.min(w, innerWidth); h = Math.min(h, innerHeight);
  const cx = sel ? sel.x + sel.w / 2 : innerWidth / 2, cy = sel ? sel.y + sel.h / 2 : innerHeight / 2;
  sel = norm({ x: Math.min(Math.max(0, cx - w / 2), innerWidth - w), y: Math.min(Math.max(0, cy - h / 2), innerHeight - h), w, h });
  draw();
}

function confirm(full) {
  if (full === true) sel = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  if (!sel || sel.w < 8 || sel.h < 8) return;
  api.send('sel:done', {
    displayId: cfg.displayId, full: full === true,
    rect: { x: Math.round(sel.x), y: Math.round(sel.y), width: Math.round(sel.w), height: Math.round(sel.h) },
    cursor: cfg.cursor, audio: cfg.audio,
  });
}

// --- chuột ---
addEventListener('pointerdown', e => {
  if (e.button !== 0 || bar.contains(e.target)) return;
  $('hint').style.opacity = 0;
  const h = e.target.dataset && e.target.dataset.h;
  if (h) drag = { mode: h, sx: e.clientX, sy: e.clientY, orig: { ...sel } };
  else if (sel && e.target === selEl) drag = { mode: 'move', sx: e.clientX, sy: e.clientY, orig: { ...sel } };
  else { drag = { mode: 'new', sx: e.clientX, sy: e.clientY }; sel = null; api.send('sel:clear-others'); }
  document.body.setPointerCapture(e.pointerId);
  draw();
});
addEventListener('pointermove', e => {
  showLoupe(e.clientX, e.clientY, !bar.contains(e.target));
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.orig;
  if (drag.mode === 'new') sel = norm({ x: drag.sx, y: drag.sy, w: dx, h: dy });
  else if (drag.mode === 'move') sel = { ...o, x: Math.min(Math.max(0, o.x + dx), innerWidth - o.w), y: Math.min(Math.max(0, o.y + dy), innerHeight - o.h) };
  else {
    let { x, y, w, h } = o;
    if (drag.mode.includes('w')) { x += dx; w -= dx; }
    if (drag.mode.includes('e')) w += dx;
    if (drag.mode.includes('n')) { y += dy; h -= dy; }
    if (drag.mode.includes('s')) h += dy;
    sel = norm({ x, y, w, h });
  }
  draw();
});
addEventListener('pointerup', e => {
  if (!drag) return;
  const wasNew = drag.mode === 'new', moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy);
  const orig = drag.orig;
  drag = null;
  if (wasNew && moved < 5) { confirm(true); return; }   // bấm 1 lần = cả màn hình
  if (!wasNew && orig && (!sel || sel.w < 8 || sel.h < 8)) sel = orig;   // kéo teo về 0 thì trả lại vùng cũ
  draw();
});
addEventListener('dblclick', e => { if (sel && e.target === selEl) confirm(); });

function showLoupe(x, y, on) {
  if (!img || !on) { loupe.style.display = 'none'; return; }
  loupe.style.display = 'block';
  const lx = x + 140 > innerWidth ? x - 140 : x + 20, ly = y + 150 > innerHeight ? y - 150 : y + 20;
  loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px';
  const sx = img.naturalWidth / innerWidth, sy = img.naturalHeight / innerHeight, z = 8, n = 120 / z;
  lc.imageSmoothingEnabled = false;
  lc.fillStyle = '#000'; lc.fillRect(0, 0, 120, 120);
  lc.drawImage(img, x * sx - n / 2, y * sy - n / 2, n, n, 0, 0, 120, 120);
  lc.fillStyle = 'rgba(229,56,59,.9)';
  lc.fillRect(59, 0, 2, 120); lc.fillRect(0, 59, 120, 2);
  $('lpos').textContent = `${phys(x)}, ${phys(y)}`;
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') api.send('sel:cancel');
  else if (e.key === 'Enter') confirm();
  else if (sel && e.key.startsWith('Arrow')) {
    const s = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
    if (e.ctrlKey) sel = norm({ ...sel, w: sel.w + d[0], h: sel.h + d[1] });
    else sel = { ...sel, x: Math.min(Math.max(0, sel.x + d[0]), innerWidth - sel.w), y: Math.min(Math.max(0, sel.y + d[1]), innerHeight - sel.h) };
    draw(); e.preventDefault();
  }
});

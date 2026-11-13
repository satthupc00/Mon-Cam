hydrateIcons();
const $ = id => document.getElementById(id);
const shot = $('shot'), selEl = $('sel'), tag = $('tag'), loupe = $('loupe'), lc = $('lc').getContext('2d');
let bar = $('bar');
let cfg = { scale: 1, w: innerWidth, h: innerHeight, cursor: true, audio: true, gif: false };
let sel = null;            // {x,y,w,h} theo DIP trong màn này
let drag = null;           // {mode,sx,sy,orig}
let img = null;
let wins = [], hover = null, downHover = null;   // khung các cửa sổ (trên cùng trước) để bắt dính khi chọn vùng quay
const hovEl = $('hov');
api.on('sel:windows', r => { wins = r || []; });

const HINT_REC = $('hint').innerHTML;
api.on('sel:init', async c => {
  cfg = c;
  resetState();
  $('hint').innerHTML = HINT_REC;
  $('hint').style.opacity = 1;
  if (c.img) {
    img = new Image(); img.src = c.img;
    shot.src = c.img;
    try { await img.decode(); await shot.decode(); } catch {}
    // Ảnh nền vẽ theo đúng kích thước màn (không co giãn theo cửa sổ): cửa sổ lệch 1-2 điểm cũng không làm nhoè ảnh
    shot.style.width = c.w + 'px'; shot.style.height = c.h + 'px';
  }
  if (c.last) {
    sel = norm({ x: c.last.x, y: c.last.y, w: c.last.w, h: c.last.h });
    $('hint').innerHTML = 'Đang hiện <b>vùng lần trước</b> · <kbd>Enter</kbd> quay luôn · kéo mép để chỉnh hoặc kéo chỗ khác để chọn vùng mới · <kbd>Esc</kbd> huỷ';
  }
  $('pLast').hidden = !c.last;
  if (c.shot) {
    setupShot();
    if (c.last) $('hint').innerHTML = '<span class="cam">Chụp ảnh</span> · Đang hiện <b>vùng chụp lần trước</b> · <kbd>Enter</kbd> copy · kéo mép để chỉnh hoặc kéo chỗ khác để chọn vùng mới · <kbd>Esc</kbd> huỷ';
  } else { $('shotbar').style.display = 'none'; bar = $('bar'); }
  sizeCanvas(); syncToggles(); draw();
  if (!c.cursorHere) $('hint').style.opacity = 0;
  requestAnimationFrame(() => api.send('sel:ready'));
});
// Cửa sổ được giấu đi để dùng lại lần sau: xoá sạch trạng thái
function resetState() {
  sel = null; drag = null; wins = []; hover = null; downHover = null; hovEl.style.display = 'none';
  Ann.cancelText(); Ann.items = []; Ann.cur = null; Ann.tool = null;
  if (Ann.ctx) Ann.redraw();   // xoá nét vẽ của lần chụp trước
  document.body.classList.remove('tool-on', 'tool-text');
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('on'));
  loupe.style.display = 'none';
  bar.style.display = 'none';
}
api.on('sel:reset', () => {
  resetState(); cfg = { ...cfg, shot: false }; img = null; shade(null);
  shot.removeAttribute('src');
  draw();
});
api.on('sel:clear', () => { sel = null; draw(); });

// ---------- chế độ chụp ảnh ----------
const TOOL_KEYS = { a: 'arrow', l: 'line', r: 'rect', t: 'text', p: 'pen', b: 'blur' };
const SIZE_NAMES = ['Nét mảnh', 'Nét dày', 'Nét rất dày'];
let shotReady = false, SHOT_HINT = '';
function setupShot() {
  $('bar').style.display = 'none';
  bar = $('shotbar');
  Ann.img = img;
  if (shotReady) { $('hint').innerHTML = SHOT_HINT; return; }
  shotReady = true;
  $('hint').innerHTML = SHOT_HINT = '<span class="cam">Chụp ảnh</span> · Kéo để chọn vùng · <kbd>Enter</kbd> copy · <kbd>Ctrl+S</kbd> lưu · <kbd>Ctrl+Z</kbd> hoàn tác · <kbd>Esc</kbd> huỷ';
  // 1 ô màu tự do, nhớ màu lần trước
  let saved = '#FF0000';
  try { saved = localStorage.getItem('shotColor') || saved; } catch {}
  $('colorInp').value = saved; setColor(saved);
  $('colorInp').oninput = () => setColor($('colorInp').value);
  // độ dày nét: 1 nút, bấm xổ ngang 3 nấc
  const sz = $('sizes');
  SIZE_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'sizebtn'; b.title = `${n} (${i + 1})`; b.dataset.s = i;
    b.innerHTML = `<i style="width:${[4, 8, 13][i]}px;height:${[4, 8, 13][i]}px"></i>`;
    b.onclick = () => { setSize(i); sz.hidden = true; };
    sz.appendChild(b);
  });
  $('sizeBtn').onclick = e => {
    e.stopPropagation();
    sz.hidden = !sz.hidden;
    // thanh nằm bên trái khung thì xổ sang trái cho khỏi đè lên vùng chọn
    sz.classList.toggle('left', bar.getBoundingClientRect().left < (sel ? sel.x : 0));
  };
  addEventListener('pointerdown', e => { if (!e.target.closest('.szwrap')) sz.hidden = true; }, true);
  setSize(0);
  bar.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(Ann.tool === b.dataset.tool ? null : b.dataset.tool));
  $('saveBtn').onclick = () => doShot(true);
  Ann.init(img, () => sel, () => {});
  Ann.base = () => [cfg.w, cfg.h];
}
function setColor(c) {
  Ann.color = c;
  $('colorBtn').style.setProperty('--c', c);
  if (Ann.textEl) Ann.textEl.style.color = c;
  try { localStorage.setItem('shotColor', c); } catch {}
}
function setSize(i) {
  const d = [4, 8, 13][i], dot = document.querySelector('#sizeBtn .dot');
  if (dot) { dot.style.width = d + 'px'; dot.style.height = d + 'px'; }
  Ann.size = i;
  $('sizes').querySelectorAll('.sizebtn').forEach(b => b.classList.toggle('on', +b.dataset.s === i));
}
function setTool(t) {
  Ann.commitText();
  Ann.tool = t;
  bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  document.body.classList.toggle('tool-on', !!t);
  document.body.classList.toggle('tool-text', t === 'text');
  draw();
}
function doShot(save) {
  if (!sel || sel.w < 2 || sel.h < 2 || !img) return;
  const r = Ann.export();
  api.send('shot:done', { url: r.url, w: r.w, h: r.h, displayId: cfg.displayId, save: save === true, diag: Ann.diag,
    rect: { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) } });
}

function sizeCanvas() {}
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

// Phủ tối 50% ngoài vùng chọn bằng 4 khối màu (rẻ hơn nhiều so với tô lại cả canvas mỗi lần rê chuột)
const shades = ['t', 'b', 'l', 'r'].map(k => $('sh' + k));
function shade(r) {
  const [t, b, l, rt] = shades;
  if (!r) { Object.assign(t.style, { left: 0, top: 0, width: '100%', height: '100%' }); [b, l, rt].forEach(e => e.style.height = '0'); return; }
  const W = innerWidth, H = innerHeight, x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  Object.assign(t.style, { left: 0, top: 0, width: W + 'px', height: y + 'px' });
  Object.assign(b.style, { left: 0, top: y + h + 'px', width: W + 'px', height: Math.max(0, H - y - h) + 'px' });
  Object.assign(l.style, { left: 0, top: y + 'px', width: x + 'px', height: h + 'px' });
  Object.assign(rt.style, { left: x + w + 'px', top: y + 'px', width: Math.max(0, W - x - w) + 'px', height: h + 'px' });
}

function drawHover() {
  const h = !cfg.shot && !drag && hover;
  if (!h) { hovEl.style.display = 'none'; if (!sel) tag.style.display = 'none'; return; }
  Object.assign(hovEl.style, { display: 'block', left: h.x + 'px', top: h.y + 'px', width: h.w + 'px', height: h.h + 'px' });
  if (!sel) {   // chưa có vùng chọn: nhãn kích thước theo cửa sổ đang rê
    tag.textContent = `${phys(h.w)} × ${phys(h.h)}`;
    tag.style.display = 'block'; tag.style.left = h.x + 'px'; tag.style.top = (h.y > 30 ? h.y - 28 : h.y + 6) + 'px';
  }
}
const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
function updateHover(x, y) {
  if (cfg.shot || drag) return;
  const h = inRect(sel, x, y) ? null : (wins.find(r => inRect(r, x, y)) || null);
  if (h !== hover) { hover = h; draw(); }
}

function draw() {
  shade(sel || (!cfg.shot && hover) || null);
  if (sel) drawHover();
  if (cfg.shot && (Ann.items.length || Ann.cur)) Ann.redraw();
  selEl.classList.toggle('drawing', !!(cfg.shot && Ann.tool));
  if (!sel) { selEl.style.display = tag.style.display = bar.style.display = 'none'; drawHover(); return; }
  Object.assign(selEl.style, { display: 'block', left: sel.x - 1 + 'px', top: sel.y - 1 + 'px', width: sel.w + 2 + 'px', height: sel.h + 2 + 'px' });
  tag.textContent = `${phys(sel.w)} × ${phys(sel.h)}`;
  tag.style.display = 'block';
  // nhãn kích thước nằm NGOÀI khung: chụp ảnh → phía trên (thanh nút ở bên phải); quay → phía dưới (thanh nút ở trên).
  // Không đủ chỗ thì sang phía còn lại, cuối cùng mới vào trong góc khung
  const th = tag.offsetHeight || 22, tw = tag.offsetWidth || 90, gap = 6;
  const above = sel.y - th - gap, below = sel.y + sel.h + gap;
  const fitA = above >= 2, fitB = below + th <= innerHeight - 2;
  let ty = cfg.shot ? (fitA ? above : fitB ? below : sel.y + gap) : (fitB ? below : fitA ? above : sel.y + gap);
  tag.style.left = Math.min(Math.max(2, sel.x), innerWidth - tw - 2) + 'px';
  tag.style.top = ty + 'px';
  if (!drag) placeBar(); else bar.style.display = 'none';
}

function placeBar() {
  bar.style.display = 'flex';
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  if (cfg.shot) {   // chụp ảnh: thanh dọc bên phải khung; hết chỗ thì sang trái, rồi vào trong
    let x = sel.x + sel.w + 10;
    if (x + bw > innerWidth - 4) x = sel.x - bw - 10;
    if (x < 4) x = sel.x + sel.w - bw - 8;
    const y = Math.min(Math.max(4, sel.y), innerHeight - bh - 4);
    bar.style.left = x + 'px'; bar.style.top = y + 'px';
    return;
  }
  let x = Math.min(Math.max(4, sel.x), innerWidth - bw - 4);
  let y = sel.y - bh - 10;                                   // thanh nút nằm phía trên khung
  if (y < 4) y = sel.y + sel.h + 10;                         // sát mép trên: xuống dưới khung
  if (y + bh > innerHeight - 4) y = sel.y + 8;               // khung gần kín màn: vào trong, sát mép trên
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
  if (cfg.shot) { if (full === true) { sel = { x: 0, y: 0, w: innerWidth, h: innerHeight }; draw(); } else doShot(); return; }
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
  if (e.button !== 0 || bar.contains(e.target) || e.target.closest('.ann-text')) return;
  if (cfg.shot && Ann.tool && sel && !(e.target.dataset && e.target.dataset.h)) {
    // đang cầm công cụ: chỉ vẽ trong vùng chọn, bấm ra ngoài không làm mất vùng
    if (Ann.down(e)) document.body.setPointerCapture(e.pointerId);
    return;
  }
  $('hint').style.opacity = 0;
  const h = e.target.dataset && e.target.dataset.h;
  if (h) drag = { mode: h, sx: e.clientX, sy: e.clientY, orig: { ...sel } };
  else if (sel && e.target === selEl) drag = { mode: 'move', sx: e.clientX, sy: e.clientY, orig: { ...sel } };
  else { downHover = hover; drag = { mode: 'new', sx: e.clientX, sy: e.clientY }; sel = null; api.send('sel:clear-others'); }
  document.body.setPointerCapture(e.pointerId);
  draw();
});
addEventListener('pointermove', e => {
  if (Ann.cur) { Ann.move(e); return; }
  updateHover(e.clientX, e.clientY);
  showLoupe(e.clientX, e.clientY, !bar.contains(e.target) && !(cfg.shot && Ann.tool));
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
  if (Ann.up()) return;
  if (!drag) return;
  const wasNew = drag.mode === 'new', moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy);
  const orig = drag.orig;
  drag = null;
  if (wasNew && moved < 5) {
    // bấm 1 cái lên cửa sổ đang được viền đỏ = chọn đúng cửa sổ đó; bấm chỗ trống = cả màn hình
    if (!cfg.shot && downHover) { sel = { ...downHover }; hover = null; downHover = null; }
    else { confirm(true); return; }
  }
  if (!wasNew && orig && (!sel || sel.w < 8 || sel.h < 8)) sel = orig;   // kéo teo về 0 thì trả lại vùng cũ
  // Quay video: kéo xong là chuyển sang khung chờ quay (màn thật, bấm xuyên qua được)
  if (!cfg.shot && sel && sel.w >= 8 && sel.h >= 8) {
    api.send('sel:arm', { displayId: cfg.displayId, rect: { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) }, cursor: cfg.cursor, audio: cfg.audio });
    return;
  }
  draw();
});
addEventListener('dblclick', e => { if (sel && e.target === selEl) confirm(); });

function showLoupe(x, y, on) {
  if (!img || !on) { loupe.style.display = 'none'; return; }
  loupe.style.display = 'block';
  const lx = x + 140 > innerWidth ? x - 140 : x + 20, ly = y + 150 > innerHeight ? y - 150 : y + 20;
  loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px';
  const sx = img.naturalWidth / cfg.w, sy = img.naturalHeight / cfg.h, z = 8, n = 120 / z;
  lc.imageSmoothingEnabled = false;
  lc.fillStyle = '#000'; lc.fillRect(0, 0, 120, 120);
  lc.drawImage(img, x * sx - n / 2, y * sy - n / 2, n, n, 0, 0, 120, 120);
  lc.fillStyle = 'rgba(229,56,59,.9)';
  lc.fillRect(59, 0, 2, 120); lc.fillRect(0, 59, 120, 2);
  $('lpos').textContent = `${phys(x)}, ${phys(y)}`;
}

addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('.ann-text')) return;
  if (cfg.shot) {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'c') { doShot(false); e.preventDefault(); return; }
    if (e.ctrlKey && k === 's') { doShot(true); e.preventDefault(); return; }
    if (e.ctrlKey && k === 'z') { Ann.undo(); e.preventDefault(); return; }
    if (sel && !e.ctrlKey && !e.altKey && ['1', '2', '3'].includes(k)) { setSize(+k - 1); return; }
    if (sel && !e.ctrlKey && !e.altKey && TOOL_KEYS[k]) { setTool(Ann.tool === TOOL_KEYS[k] ? null : TOOL_KEYS[k]); return; }
  }
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

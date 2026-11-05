hydrateIcons();
const $ = id => document.getElementById(id);
const selEl = $('sel'), tag = $('tag'), bar = $('bar');
let cfg = { scale: 1, cursor: true, audio: true, gif: false };
let sel = null, drag = null, hit = false;

api.on('arm:init', c => { cfg = c; sel = { ...c.rect }; draw(); });

const phys = v => Math.round(v * cfg.scale);
function norm(r) {
  let { x, y, w, h } = r;
  if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(w, innerWidth - x); h = Math.min(h, innerHeight - y);
  return { x, y, w, h };
}
const shades = ['t', 'b', 'l', 'r'].map(k => $('sh' + k));
function draw() {
  if (!sel) return;
  const [t, b, l, rt] = shades, W = innerWidth, H = innerHeight;
  const x = Math.round(sel.x), y = Math.round(sel.y), w = Math.round(sel.w), h = Math.round(sel.h);
  Object.assign(t.style, { width: W + 'px', height: y + 'px' });
  Object.assign(b.style, { top: y + h + 'px', width: W + 'px', height: Math.max(0, H - y - h) + 'px' });
  Object.assign(l.style, { top: y + 'px', width: x + 'px', height: h + 'px' });
  Object.assign(rt.style, { left: x + w + 'px', top: y + 'px', width: Math.max(0, W - x - w) + 'px', height: h + 'px' });
  Object.assign(selEl.style, { left: x - 1 + 'px', top: y - 1 + 'px', width: w + 2 + 'px', height: h + 2 + 'px' });
  tag.innerHTML = icon('region') + `${phys(w)} × ${phys(h)}`;
  tag.style.left = x + 'px';
  tag.style.left = x + 6 + 'px';
  tag.style.top = y + 6 + 'px';   // nhãn kích thước nằm trong góc khung
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let bx = Math.min(Math.max(4, x), W - bw - 4), by = y - bh - 10;   // thanh nút phía trên khung
  if (by < 4) by = y + h + 10;
  if (by + bh > H - 4) by = y + 40;
  bar.style.left = bx + 'px'; bar.style.top = by + 'px';
}
addEventListener('resize', draw);

$('cancel').onclick = () => api.send('arm:cancel');
$('redo').onclick = () => api.send('arm:redo');
$('go').onclick = () => {
  if (!sel || sel.w < 8 || sel.h < 8) return;
  api.send('arm:go', { rect: { x: Math.round(sel.x), y: Math.round(sel.y), width: Math.round(sel.w), height: Math.round(sel.h) }, cursor: cfg.cursor, audio: cfg.audio });
};

// Chuột chỉ bị giữ lại khi đang ở trên thanh nút / nút kéo mép / nhãn; còn lại bấm xuyên qua
const interactive = el => !!(el && el.closest && el.closest('.bar, .h, .tag'));
function setHit(on) { if (on !== hit) { hit = on; api.send('arm:hit', on); } }
addEventListener('mousemove', e => { if (!drag) setHit(interactive(e.target)); });
addEventListener('mouseleave', () => { if (!drag) setHit(false); });

addEventListener('pointerdown', e => {
  const h = e.target.dataset && e.target.dataset.h;
  if (!h || e.button !== 0) return;
  drag = { mode: h, sx: e.clientX, sy: e.clientY, orig: { ...sel } };
  document.body.setPointerCapture(e.pointerId);
});
addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.orig;
  if (drag.mode === 'move') sel = { ...o, x: Math.min(Math.max(0, o.x + dx), innerWidth - o.w), y: Math.min(Math.max(0, o.y + dy), innerHeight - o.h) };
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
  if (!sel || sel.w < 8 || sel.h < 8) sel = drag.orig;
  drag = null; draw();
  setHit(interactive(document.elementFromPoint(e.clientX, e.clientY)));
});

hydrateIcons();
const $ = id => document.getElementById(id);
if (api.isElectron) document.documentElement.classList.add('electron');

let S = {};             // cài đặt
let mode = 'region';
let recState = { state: 'idle' };
let updState = null;

// ---------- tiện ích ----------
const fmtDur = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
const fmtTc = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`; };
const fmtB = b => b == null ? '' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(text, kind, action) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'ok' ? ' ok' : '');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (action) { const a = document.createElement('a'); a.textContent = action.label; a.onclick = action.fn; t.appendChild(a); }
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}
api.on('toast', d => toast(d.text, d.kind));
api.on('busy', d => {
  $('busy').hidden = !d;
  if (d) { $('busyTxt').textContent = d.text; $('busyP').parentElement.hidden = d.p == null; $('busyP').style.width = ((d.p || 0) * 100) + '%'; }
});

// tô phần đã kéo của mọi slider
(function tick() {
  document.querySelectorAll('input[type=range]').forEach(r => r.style.setProperty('--fill', ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0)) * 100) + '%'));
  requestAnimationFrame(tick);
})();

// ---------- cài đặt ----------
async function setS(patch) { S = { ...S, ...patch, ...((await api.invoke('settings:set', patch).catch(() => null)) || {}) }; renderSettings(); }
function renderSettings() {
  document.querySelectorAll('.seg[data-key]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(S[g.dataset.key]) === b.dataset.v)));
  document.querySelectorAll('input.sw[data-key]').forEach(c => { c.checked = !!S[c.dataset.key]; });
  const gif = S.format === 'gif';
  $('gifHint').hidden = !gif;
  $('audioRow').classList.toggle('disabled', gif);
  $('outDir').textContent = S.outDir;
  $('outDir').title = S.outDir;
  $('shotDir').textContent = S.shotDir || ''; $('shotDir').title = S.shotDir || '';
  renderSum();
  refreshFoot();
}
document.querySelectorAll('.seg[data-key]').forEach(g => g.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = g.dataset.key, v = k === 'fps' ? +b.dataset.v : b.dataset.v;
  setS({ [k]: v });
}));
document.querySelectorAll('input.sw[data-key]').forEach(c => c.addEventListener('change', () => setS({ [c.dataset.key]: c.checked })));

api.on('settings', s => { S = s; renderSettings(); });

// ---------- màn chính ----------
const MODE_LABEL = { region: 'Chọn vùng & quay', fullscreen: 'Quay toàn màn hình', window: 'Chọn cửa sổ & quay' };
function setMode(m) {
  mode = m;
  document.querySelectorAll('#modes .card').forEach(c => c.classList.toggle('on', c.dataset.mode === m));
  renderRecBtn();
  try { localStorage.setItem('mode', m); } catch {}
}
$('modes').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) setMode(c.dataset.mode); });
$('modes').addEventListener('dblclick', e => { const c = e.target.closest('.card'); if (c) startRec(); });

function renderRecBtn() {
  const busy = recState.state !== 'idle';
  $('recBtn').classList.toggle('rec', busy);
  $('recLabel').textContent = busy ? 'Dừng quay' : MODE_LABEL[mode];
  $('recBtn').title = busy ? 'Dừng & lưu (F12 / Esc)' : MODE_LABEL[mode];
}
function renderSum() {
  const gif = S.format === 'gif';
  const parts = [`<b>${gif ? 'GIF' : 'MP4'}</b>`, `${S.fps} fps`, S.cursor ? 'có chuột' : 'ẩn chuột'];
  if (!gif) parts.push(S.audio ? 'có âm thanh máy' : 'không tiếng');
  if (S.countdown) parts.push('đếm ngược 3s');
  let last = '';
  if (S.lastRegion && S.lastRegion.phys) last = `<br><kbd>F12</kbd> chọn vùng & quay · vùng trước ${S.lastRegion.phys.w}×${S.lastRegion.phys.h} · <kbd>Esc</kbd> dừng`;
  $('sum').innerHTML = parts.join(' · ') + last;
}

function startRec() {
  if (recState.state !== 'idle') return api.invoke('rec:stop');
  if (mode === 'window') return openWindowPicker();
  api.invoke('rec:start', mode);
}
$('recBtn').onclick = startRec;
$('shotBtn').onclick = () => api.invoke('shot:start');
$('sum').onclick = () => openDlg('dlgSettings');

api.on('rec:state', s => { recState = s; renderRecBtn(); });

async function openWindowPicker() {
  const g = $('wgrid');
  g.innerHTML = '<div class="muted">Đang tìm cửa sổ…</div>';
  openDlg('dlgWindows');
  const list = (await api.invoke('windows:list').catch(() => null)) || [];
  if (!list.length) { g.innerHTML = '<div class="muted">Không thấy cửa sổ nào đang mở.</div>'; return; }
  g.innerHTML = '';
  list.forEach(w => {
    const b = document.createElement('button');
    b.className = 'witem'; b.title = w.title;
    b.innerHTML = `<div class="wi"></div><span>${esc(w.title)}</span>`;
    if (w.img) b.querySelector('.wi').style.backgroundImage = `url("${w.img}")`;
    b.onclick = () => { closeDlg('dlgWindows'); api.invoke('rec:start', 'window', { id: w.id, title: w.title }); };
    g.appendChild(b);
  });
}

async function loadRecent() {
  const list = (await api.invoke('files:list').catch(() => null)) || [];
  const box = $('recent');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty"><b>Chưa có bản quay nào</b><span>Chọn kiểu quay rồi bấm nút đỏ, hoặc nhấn <kbd>F12</kbd> để chọn vùng và quay.</span></div>';
    return;
  }
  for (const it of list) {
    const b = document.createElement('button');
    b.className = 'rec-item'; b.title = it.name + ' · ' + fmtB(it.size);
    const gif = /\.gif$/i.test(it.name);
    b.innerHTML = `<div class="thumb"><span class="fmt ${gif ? 'gif' : ''}">${gif ? 'GIF' : 'MP4'}</span><span class="dur" hidden></span></div><span class="meta">${esc(it.name)}</span>`;
    b.onclick = () => openEditor(it.file);
    box.appendChild(b);
    api.invoke('files:thumb', it.file).then(u => { if (u) b.querySelector('.thumb').style.backgroundImage = `url("${u}")`; });
  }
}
$('seeAll').onclick = () => api.invoke('files:openDir');
$('openDir').onclick = () => api.invoke('files:openDir');

async function refreshFoot() {
  if (!$('editor').hidden && cur) { $('footInfo').textContent = cur.file; return; }
  const free = await api.invoke('files:free').catch(() => null);
  $('footInfo').textContent = (free != null ? `Còn trống ${fmtB(free)} · ` : '') + 'Lưu tại ' + (S.outDir || '');
}

api.on('rec:done', d => {
  loadRecent();
  toast('Đã lưu ' + d.file.split(/[\\/]/).pop(), 'ok', { label: 'Mở thư mục', fn: () => api.invoke('files:openDir', d.file) });
  if (d.open) openEditor(d.file);
});

// ---------- XEM LẠI & CẮT (nhiều đoạn) ----------
// Mỗi đoạn {id,s,e} là 1 khoảng thời gian trong clip gốc. Timeline xếp các đoạn sát nhau theo thứ tự;
// "thời gian timeline" = cộng dồn độ dài các đoạn.
const vid = $('vid');
let cur = null;           // thông tin clip đang mở
let segs = [], selId = null, hist = [], segSeq = 0;
let ci = 0;               // đoạn đang phát
let playing = false;
let stripUrl = null;

function showView(v) {
  $('home').hidden = v !== 'home';
  $('editor').hidden = v !== 'editor';
  $('backBtn').hidden = v !== 'editor';
  $('openDir').hidden = v === 'editor';
  api.invoke('win:layout', v).catch(() => {});
  if (v === 'home') { vid.pause(); vid.removeAttribute('src'); vid.load(); cur = null; loadRecent(); }
  refreshFoot();
}
$('backBtn').onclick = () => showView('home');

const newSeg = (s, e) => ({ id: ++segSeq, s, e });
const segLen = g => g.e - g.s;
const total = () => segs.reduce((t, g) => t + segLen(g), 0);
const startOf = i => { let t = 0; for (let k = 0; k < i; k++) t += segLen(segs[k]); return t; };
function locate(t) {            // thời gian timeline → {i, src}
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const d = segLen(segs[i]);
    if (t < acc + d || i === segs.length - 1) return { i, src: segs[i].s + Math.min(d, Math.max(0, t - acc)) };
    acc += d;
  }
  return { i: 0, src: 0 };
}
function pos() {                // vị trí vạch đỏ theo thời gian timeline
  const g = segs[ci]; if (!g) return 0;
  return startOf(ci) + Math.min(segLen(g), Math.max(0, (vid.currentTime || 0) - g.s));
}
function seekTo(t) {
  if (!segs.length) return;
  const L = locate(Math.max(0, Math.min(total(), t)));
  ci = L.i; vid.currentTime = L.src;
}
function pushHist() { hist.push(JSON.stringify({ segs, selId })); if (hist.length > 100) hist.shift(); }
function undo() {
  const h = hist.pop(); if (!h) return;
  const o = JSON.parse(h); segs = o.segs; selId = o.selId;
  ci = Math.min(ci, segs.length - 1); renderSegs(true);
}

async function openEditor(file) {
  const info = await api.invoke('media:open', file).catch(() => null);
  if (!info) { toast('Không mở được file này', 'error'); return; }
  cur = info;
  showView('editor');
  const isImg = info.isGif;
  $('gifImg').hidden = !isImg; vid.hidden = isImg;
  $('ctrl').classList.toggle('off', isImg); $('timeline').classList.toggle('off', isImg);
  $('mp4Grp').hidden = isImg; $('gifGrp').hidden = isImg;
  if (isImg) $('gifImg').src = info.url; else { vid.src = info.url; vid.load(); }
  segs = [newSeg(0, info.duration || 0)]; selId = null; hist = []; ci = 0;
  $('iName').textContent = info.name; $('iName').title = info.name;
  $('iSize').textContent = info.width ? `${info.width} × ${info.height}` : '—';
  $('iFps').textContent = info.fps || '—';
  $('iDur').textContent = fmtTc(info.duration);
  $('iBytes').textContent = fmtB(info.size);
  $('owRow').hidden = !/\.mp4$/i.test(info.file);
  $('overwrite').checked = false;
  stripUrl = null;
  renderSegs(true);
  const n = Math.max(8, Math.round($('track').clientWidth / 90));
  if (!isImg) api.invoke('media:strip', info.src, n).then(u => { if (u && cur === info) { stripUrl = u; renderSegs(true); } });
}

vid.addEventListener('loadedmetadata', () => {
  if (cur && isFinite(vid.duration) && (!cur.duration || Math.abs(vid.duration - cur.duration) > 0.5)) {
    const old = cur.duration; cur.duration = vid.duration; $('iDur').textContent = fmtTc(vid.duration);
    if (segs.length === 1 && segs[0].s === 0 && Math.abs(segs[0].e - old) < 0.01) segs[0].e = vid.duration;
    renderSegs(true);
  }
});
vid.addEventListener('play', () => { playing = true; renderPlay(); });
vid.addEventListener('pause', () => { playing = false; renderPlay(); });
$('volume').oninput = () => { vid.volume = $('volume').value / 100; };
vid.volume = .8;

function renderPlay() { $('playBtn').innerHTML = icon(playing ? 'pause' : 'play'); }
renderPlay();

// --- vẽ timeline ---
const track = $('track'), tl = $('tl');
function buildRuler() {
  const r = $('ruler'), d = total(); r.innerHTML = '';
  if (!d) return;
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const sp = document.createElement('span');
    sp.style.left = (i / n * 100) + '%';
    sp.textContent = fmtDur(d * i / n);
    r.appendChild(sp);
  }
}
function segEl(g) {
  let el = track.querySelector(`.segk[data-id="${g.id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'segk'; el.dataset.id = g.id;
    el.innerHTML = '<span class="lab"></span><span class="dur"></span><i class="sg l" title="Kéo để tỉa đầu đoạn"></i><i class="sg r" title="Kéo để tỉa cuối đoạn"></i>';
    track.appendChild(el);
  }
  return el;
}
// Đặt vị trí/khổ cho các khối. order: thứ tự hiển thị (có thể khác segs khi đang kéo)
function layout(order, opts = {}) {
  const W = track.clientWidth, T = total() || 1, srcD = (cur && cur.duration) || T;
  let x = 0;
  order.forEach(g => {
    const w = segLen(g) / T * W;
    if (g === opts.slot) { const sl = track.querySelector('.segslot'); if (sl) { sl.style.width = Math.max(4, w - 4) + 'px'; sl.style.transform = `translateX(${x + 2}px)`; } }
    const el = segEl(g);
    el.style.width = Math.max(6, w - 4) + 'px';
    if (g !== opts.dragging) el.style.transform = `translateX(${x + 2}px)`;
    if (stripUrl) {
      const bw = w * srcD / Math.max(0.01, segLen(g));
      el.style.backgroundImage = `url("${stripUrl}")`;
      el.style.backgroundSize = `${bw}px 100%`;
      el.style.backgroundPosition = `${-g.s / srcD * bw}px 0`;
    } else el.style.backgroundImage = '';
    x += w;
  });
}
function renderSegs(instant) {
  const ids = new Set(segs.map(g => String(g.id)));
  track.querySelectorAll('.segk').forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });
  segs.forEach((g, i) => {
    const el = segEl(g);
    el.classList.toggle('on', g.id === selId);
    el.querySelector('.lab').textContent = `Đoạn ${i + 1} · ${fmtDur(g.s)}–${fmtDur(g.e)}`;
    el.querySelector('.dur').textContent = segLen(g).toFixed(1) + 's';
    if (instant) el.style.transition = 'none';
  });
  layout(segs);
  if (instant) requestAnimationFrame(() => track.querySelectorAll('.segk').forEach(el => el.style.transition = ''));
  buildRuler();
  const T = total();
  $('tcDur').textContent = fmtTc(T);
  $('iTotal').textContent = fmtTc(T);
  $('iCount').textContent = segs.length;
  $('segInfo').innerHTML = `${segs.length} đoạn · tổng <b>${fmtTc(T)}</b>`;
  $('delSegBtn').disabled = !selId || segs.length < 2;
  $('undoBtn').disabled = !hist.length;
  renderGifEst();
}
addEventListener('resize', () => { if (cur && !$('editor').hidden) renderSegs(true); });

function renderGifEst() {
  if (!cur) return;
  const fps = gifFps(), sc = gifScale() / 100, d = total();
  const est = (cur.width || 800) * (cur.height || 450) * sc * sc * fps * d * 0.09;
  $('saveGif').lastChild.textContent = `Xuất GIF (~${fmtB(est)})`;
}

// Phát liền mạch qua các đoạn
(function loop() {
  if (cur && !vid.hidden && segs.length) {
    const g = segs[ci];
    if (playing && g && vid.currentTime >= g.e - 0.02) {
      if (ci < segs.length - 1) { ci++; vid.currentTime = segs[ci].s; }
      else { vid.pause(); vid.currentTime = g.e; }
    }
    const T = total() || 1, p = pos();
    $('ph').style.left = (p / T * 100) + '%';
    $('tcCur').textContent = fmtTc(p);
  }
  requestAnimationFrame(loop);
})();

function togglePlay() {
  if (!cur || vid.hidden) return;
  if (playing) return vid.pause();
  if (pos() >= total() - 0.03) seekTo(0);
  else { const g = segs[ci]; if (vid.currentTime < g.s || vid.currentTime > g.e) vid.currentTime = g.s; }
  vid.play().catch(() => {});
}
$('playBtn').onclick = togglePlay;
$('player').onclick = togglePlay;
$('toIn').onclick = () => seekTo(0);
$('toOut').onclick = () => seekTo(total());

// --- thao tác đoạn ---
function splitAt() {
  if (!cur) return;
  const p = pos(), L = locate(p), g = segs[L.i];
  if (L.src - g.s < 0.1 || g.e - L.src < 0.1) { toast('Đưa vạch đỏ vào giữa đoạn để cắt'); return; }
  pushHist();
  const a = newSeg(g.s, L.src), b = newSeg(L.src, g.e);
  segs.splice(L.i, 1, a, b);
  selId = b.id; ci = L.i + 1; vid.currentTime = b.s;
  renderSegs(true);
  segEl(b).classList.add('pop'); setTimeout(() => segEl(b).classList.remove('pop'), 300);
}
function deleteSel() {
  const i = segs.findIndex(g => g.id === selId);
  if (i < 0) return;
  if (segs.length < 2) { toast('Phải còn ít nhất 1 đoạn'); return; }
  pushHist();
  const p = startOf(i);
  segs.splice(i, 1);
  selId = (segs[i] || segs[i - 1]).id;
  renderSegs(false);   // các khối sau trượt sang trái khít lại
  seekTo(Math.min(p, total()));
}
$('splitBtn').onclick = splitAt;
$('delSegBtn').onclick = deleteSel;
$('undoBtn').onclick = undo;
$('resetCut').onclick = () => { if (!cur) return; pushHist(); segs = [newSeg(0, cur.duration)]; selId = null; ci = 0; vid.currentTime = 0; renderSegs(true); };

// --- chuột trên timeline: tua / chọn / tỉa / kéo đổi chỗ ---
function timeAt(x) { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)) * total(); }
let act = null;
tl.addEventListener('pointerdown', e => {
  if (!cur || e.button !== 0) return;
  const el = e.target.closest('.segk');
  tl.setPointerCapture(e.pointerId);
  if (e.target.classList.contains('sg') && el) {               // tỉa mép
    const g = segs.find(x => String(x.id) === el.dataset.id);
    pushHist();
    act = { type: 'trim', g, side: e.target.classList.contains('l') ? 's' : 'e', el };
    el.classList.add('trimming'); vid.pause();
    return;
  }
  if (el) {                                                     // có thể là bấm chọn hoặc kéo đổi chỗ
    const g = segs.find(x => String(x.id) === el.dataset.id);
    act = { type: 'press', g, el, sx: e.clientX, t: timeAt(e.clientX) };
    return;
  }
  act = { type: 'seek' }; tl.classList.add('scrub'); vid.pause(); seekTo(timeAt(e.clientX));
});
tl.addEventListener('pointermove', e => {
  if (!act) return;
  if (act.type === 'seek') { seekTo(timeAt(e.clientX)); return; }
  if (act.type === 'trim') {
    const { g, side } = act, srcD = cur.duration;
    const r = track.getBoundingClientRect(), T = total();
    // đổi khoảng cách kéo (px) ra giây theo tỉ lệ hiện tại của timeline
    const dt = (e.movementX || 0) / r.width * T;
    if (side === 's') g.s = Math.min(g.e - 0.1, Math.max(0, g.s + dt));
    else g.e = Math.max(g.s + 0.1, Math.min(srcD, g.e + dt));
    ci = segs.indexOf(g); vid.currentTime = side === 's' ? g.s : g.e;
    renderSegs(true);
    return;
  }
  if (act.type === 'press' && Math.abs(e.clientX - act.sx) > 4) startReorder(act, e);
  if (act.type === 'drag') moveReorder(e);
});
tl.addEventListener('pointerup', e => {
  if (!act) return;
  const a = act; act = null;
  tl.classList.remove('scrub');
  if (a.type === 'trim') { a.el.classList.remove('trimming'); renderSegs(true); }
  else if (a.type === 'press') { selId = a.g.id; vid.pause(); seekTo(a.t); renderSegs(false); }
  else if (a.type === 'drag') endReorder(a, false);
});
tl.addEventListener('pointercancel', () => { if (act && act.type === 'drag') endReorder(act, true); act = null; });

// Kéo đổi chỗ: khối đang kéo đi theo chuột, các khối khác trượt (transform) nhường ô nét đứt
function startReorder(a, e) {
  pushHist();
  vid.pause();
  const r = track.getBoundingClientRect();
  a.type = 'drag';
  a.from = segs.indexOf(a.g);
  a.order = segs.slice();
  a.grab = e.clientX - (r.left + startOf(a.from) / total() * r.width);
  selId = a.g.id;
  renderSegs(false);
  a.el.classList.add('lift');
  const sl = document.createElement('div'); sl.className = 'segslot'; track.appendChild(sl);
  layout(a.order, { dragging: a.g, slot: a.g });
  moveReorder(e);
}
function moveReorder(e) {
  const a = act; if (!a) return;
  const r = track.getBoundingClientRect(), T = total(), W = r.width;
  const w = segLen(a.g) / T * W;
  let x = Math.min(W - w, Math.max(0, e.clientX - r.left - a.grab));
  a.el.style.transform = `translateX(${x + 2}px) translateY(-6px) scale(1.03)`;
  // tìm vị trí chèn: tâm khối kéo so với tâm các khối còn lại
  const center = x + w / 2, rest = a.order.filter(g => g !== a.g);
  let idx = 0, acc = 0;
  for (const g of rest) { const gw = segLen(g) / T * W; if (center > acc + gw / 2) idx++; acc += gw; }
  const order = rest.slice(); order.splice(idx, 0, a.g);
  if (order.some((g, i) => g !== a.order[i])) { a.order = order; layout(order, { dragging: a.g, slot: a.g }); }
}
function endReorder(a, cancel) {
  if (!cancel) segs = a.order;
  else segs = segs.slice();
  const sl = track.querySelector('.segslot'); if (sl) sl.remove();
  a.el.classList.remove('lift');
  ci = segs.indexOf(a.g); vid.currentTime = a.g.s;
  if (!cancel && a.order.indexOf(a.g) === a.from) hist.pop();   // thả lại chỗ cũ: không tính là 1 bước
  renderSegs(false);   // bay về đúng ô
  a.el.classList.add('pop'); setTimeout(() => a.el.classList.remove('pop'), 300);
}

// GIF
function chipGroup(id, key) {
  const g = $(id);
  g.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; g.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); renderGifEst(); });
  return () => +((g.querySelector('.chip.on') || g.querySelector('.chip')).dataset.v);
}
const gifFps = chipGroup('gifFps'), gifScale = chipGroup('gifScale');
function syncGifChips() {
  $('gifFps').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.v === S.gifFps));
  $('gifScale').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.v === S.gifScale));
  if (!$('gifFps').querySelector('.on')) $('gifFps').children[1].classList.add('on');
  if (!$('gifScale').querySelector('.on')) $('gifScale').children[1].classList.add('on');
}

$('saveCut').onclick = async () => {
  if (!cur) return;
  vid.pause();
  const ow = $('overwrite').checked && !$('owRow').hidden;
  if (ow) { vid.removeAttribute('src'); vid.load(); }
  const r = await api.invoke('media:trim', { src: cur.src, segs: segs.map(g => ({ s: g.s, e: g.e })), overwrite: ow, original: cur.file });
  if (!r.ok) { toast('Cắt bị lỗi: ' + r.error, 'error'); if (ow) openEditor(cur.file); return; }
  toast('Đã lưu ' + r.file.split(/[\\/]/).pop(), 'ok', { label: 'Mở thư mục', fn: () => api.invoke('files:openDir', r.file) });
  openEditor(r.file);
};
$('saveGif').onclick = async () => {
  if (!cur) return;
  vid.pause();
  const r = await api.invoke('media:gif', { src: cur.src, segs: segs.map(g => ({ s: g.s, e: g.e })), fps: gifFps(), scale: gifScale(), original: cur.file });
  if (!r.ok) { toast('Xuất GIF bị lỗi: ' + r.error, 'error'); return; }
  S.gifFps = gifFps(); S.gifScale = gifScale();
  toast('Đã xuất ' + r.file.split(/[\\/]/).pop(), 'ok', { label: 'Mở thư mục', fn: () => api.invoke('files:openDir', r.file) });
};
$('showFile').onclick = () => cur && api.invoke('files:openDir', cur.file);
$('delFile').onclick = async () => {
  if (!cur || !confirm('Xoá clip "' + cur.name + '"? File sẽ được chuyển vào Thùng rác.')) return;
  const f = cur.file;
  vid.pause(); vid.removeAttribute('src'); vid.load();
  await api.invoke('files:delete', f);
  toast('Đã xoá clip');
  showView('home');
};

// ---------- hộp thoại ----------
function openDlg(id) { $(id).classList.remove('closing'); $(id).hidden = false; }
function closeDlg(id) { hideScrim($(id)); }
function hideScrim(sc) {
  if (sc.hidden || sc.classList.contains('closing')) return;
  sc.classList.add('closing');
  setTimeout(() => { sc.hidden = true; sc.classList.remove('closing'); }, 160);
}
document.querySelectorAll('.scrim').forEach(s => {
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-close]')) hideScrim(s); });
});
$('setBtn').onclick = () => openDlg('dlgSettings');
$('pickShotDir').onclick = async () => { const d = await api.invoke('files:pickShotDir'); if (d) { S.shotDir = d; renderSettings(); } };
$('pickDir').onclick = async () => { const d = await api.invoke('files:pickDir'); if (d) { S.outDir = d; renderSettings(); loadRecent(); } };
$('wnBtn').onclick = openWhatsNew;

async function openWhatsNew() {
  const w = await api.invoke('whatsnew');
  const b = $('wnBody');
  if (!w) { b.innerHTML = '<div class="muted">Không có thông tin.</div>'; openDlg('dlgWhatsNew'); return; }
  const d = w.date ? w.date.split('-').reverse().join('/') : '';
  const sec = (k, cls, label) => (w[k] && w[k].length) ? `<div class="wn"><h5><span class="pill ${cls}">${label}</span></h5><ul>${w[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  let extra = '';
  if (updState && (updState.state === 'available' || updState.state === 'ready')) extra = `<div class="row"><span>Có bản mới v${esc(updState.version)}</span><button class="btn pri" id="wnUpd">Cập nhật</button></div>`;
  b.innerHTML = `<div class="wn-ver">v${esc(w.version)}${d ? ' · ' + d : ''}</div>` + sec('new', 'new', 'Mới') + sec('improved', 'imp', 'Cải thiện') + sec('fixed', 'fix', 'Sửa lỗi') + extra;
  const u = $('wnUpd'); if (u) u.onclick = () => { closeDlg('dlgWhatsNew'); updAction(); };
  openDlg('dlgWhatsNew');
}

// ---------- cập nhật ----------
let appInfo = {};
function renderUpd() {
  const s = updState && updState.state;
  [$('updBtn'), $('updBtn2')].forEach(b => {
    b.classList.toggle('checking', s === 'checking' || s === 'downloading');
    b.classList.toggle('ok', s === 'latest');
    b.classList.toggle('has', s === 'available' || s === 'ready');
    b.title = 'Kiểm tra cập nhật' + ({ checking: ' · Đang kiểm tra…', latest: ' · Đã là bản mới nhất', available: ` · Có bản mới v${updState && updState.version}`, downloading: ' · Đang tải…', ready: ' · Đã tải xong, bấm để cài', error: ' · Lỗi kiểm tra' }[s] || '');
  });
  $('latest').hidden = s !== 'latest';
  $('verTxt').textContent = `v${appInfo.version || ''} · ` + ({ checking: 'Đang kiểm tra…', latest: 'Đã là bản mới nhất', available: `Có bản mới v${updState && updState.version}`, downloading: 'Đang tải bản mới…', ready: 'Bản mới đã sẵn sàng', error: 'Không kiểm tra được' }[s] || 'Chưa kiểm tra');
  const box = $('updBox');
  if (s === 'available' || s === 'downloading' || s === 'ready') {
    box.hidden = false;
    const p = updState.p || 0;
    box.innerHTML = s === 'available'
      ? `<b>Có bản mới v${esc(updState.version)}</b><span class="muted">Tải về và cài đặt chỉ với 1 lần bấm.</span><div class="acts"><button class="btn" id="ubLater">Để sau</button><button class="btn pri" id="ubGo">Tải & cài</button></div>`
      : s === 'downloading'
        ? `<b>Đang tải v${esc(updState.version || '')}… ${Math.round(p * 100)}%</b><div class="pbar"><i style="width:${p * 100}%"></i></div>`
        : `<b>Bản v${esc(updState.version)} đã tải xong</b><span class="muted">Mon Cam sẽ khởi động lại để cài.</span><div class="acts"><button class="btn" id="ubLater">Để sau</button><button class="btn pri" id="ubGo">Khởi động lại</button></div>`;
    const l = $('ubLater'), g = $('ubGo');
    if (l) l.onclick = () => { box.hidden = true; };
    if (g) g.onclick = updAction;
  } else box.hidden = true;
}
function updAction() {
  const s = updState && updState.state;
  if (s === 'available') { updState = { ...updState, state: 'downloading', p: 0 }; renderUpd(); api.invoke('upd:download'); }
  else if (s === 'ready') { if (recState.state !== 'idle') return toast('Đang quay, hãy dừng quay trước khi cập nhật'); api.invoke('upd:install'); }
  else if (s !== 'checking' && s !== 'downloading') { updState = { state: 'checking' }; renderUpd(); api.invoke('upd:check').catch(() => { updState = { state: 'error' }; renderUpd(); }); }
}
api.on('upd', u => {
  const prev = updState && updState.state;
  if (u.state === 'downloading') u.version = updState && updState.version;
  updState = u; renderUpd();
  if (u.state === 'latest' && prev === 'checking' && manualCheck) toast('Bạn đang dùng bản mới nhất', 'ok');
  if (u.state === 'error' && manualCheck) toast('Không kiểm tra được cập nhật: ' + (u.error || ''), 'error');
  manualCheck = false;
});
let manualCheck = false;
[$('updBtn'), $('updBtn2')].forEach(b => b.onclick = () => { manualCheck = true; updAction(); });

// ---------- âm thanh máy (thu trong cửa sổ này, mỗi đoạn quay 1 file tiếng) ----------
let aRec = null, aChunks = [], aStream = null;
function reply(id, data) { api.send('audio:reply:' + id, data); }
function closeAudio() { if (aStream) aStream.getTracks().forEach(t => t.stop()); aStream = null; }
async function finishSeg(keep) {
  if (!aRec) return null;
  const r = aRec; aRec = null;
  await new Promise(res => { r.onstop = res; try { r.stop(); } catch { res(); } });
  const chunks = aChunks; aChunks = [];
  if (!keep || !chunks.length) return null;
  const buf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
  return api.invoke('audio:write', buf);
}
api.on('audio:cmd', async ({ cmd, id }) => {
  try {
    if (cmd === 'open') {
      closeAudio();
      aStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      aStream.getVideoTracks().forEach(t => t.stop());
      if (!aStream.getAudioTracks().length) { closeAudio(); return reply(id, { ok: false }); }
      reply(id, { ok: true });
    } else if (cmd === 'start') {
      if (!aStream) return reply(id, { ok: false });
      aChunks = [];
      aRec = new MediaRecorder(new MediaStream(aStream.getAudioTracks()), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
      aRec.ondataavailable = e => { if (e.data.size) aChunks.push(e.data); };
      aRec.onstart = () => reply(id, { ok: true, t: Date.now() });
      aRec.start(1000);
    } else if (cmd === 'stop') {
      const file = await finishSeg(true);
      reply(id, { ok: !!file, file });
    } else if (cmd === 'close') { await finishSeg(false); closeAudio(); reply(id, { ok: true }); }
    else if (cmd === 'cancel') { await finishSeg(false); closeAudio(); reply(id, { ok: true }); }
  } catch (e) { reply(id, { ok: false, error: String(e) }); }
});

// ---------- phím tắt trong app ----------
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  const open = [...document.querySelectorAll('.scrim')].reverse().find(s => !s.hidden && !s.classList.contains('closing'));
  if (e.key === 'Escape') { if (open) hideScrim(open); else if (!$('editor').hidden) showView('home'); return; }
  if (open || $('editor').hidden || !cur) return;
  const fd = 1 / (cur.fps || 30);
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { togglePlay(); e.preventDefault(); }
  else if (e.ctrlKey && k === 'z') { undo(); e.preventDefault(); }
  else if (k === 's' && !e.ctrlKey) splitAt();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  else if (e.key === 'ArrowLeft') { vid.pause(); seekTo(pos() - (e.shiftKey ? 1 : fd)); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { vid.pause(); seekTo(pos() + (e.shiftKey ? 1 : fd)); e.preventDefault(); }
  else if (e.key === 'Home') seekTo(0);
  else if (e.key === 'End') seekTo(total());
});

// ---------- khởi động ----------
(async () => {
  S = { format: 'mp4', fps: 30, quality: 'medium', cursor: true, audio: true, gifFps: 15, gifScale: 75, outDir: '', ...((await api.invoke('settings:get').catch(() => null)) || {}) };
  appInfo = (await api.invoke('app:info').catch(() => null)) || {};
  try { const m = localStorage.getItem('mode'); if (MODE_LABEL[m]) mode = m; } catch {}
  setMode(mode);
  renderSettings(); syncGifChips(); renderUpd();
  loadRecent();
  recState = (await api.invoke('rec:state').catch(() => null)) || { state: 'idle' };
  renderRecBtn();
})();

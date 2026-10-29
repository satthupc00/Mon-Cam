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

// ---------- XEM LẠI & CẮT (nhiều đoạn, có khoảng trống) ----------
// Mỗi đoạn {id,s,e,t}: s..e là khoảng trong clip gốc, t là chỗ bắt đầu trên timeline.
// Các đoạn không chồng lên nhau; chỗ trống giữa các đoạn khi lưu sẽ là hình đen + im lặng.
const vid = $('vid');
let cur = null;           // thông tin clip đang mở
let segs = [], selId = null, hist = [], segSeq = 0;
let playing = false, P = 0, lastTick = 0;   // P = vị trí vạch đỏ (giây trên timeline)
let stripUrl = null;
let pps = 50;             // số pixel cho 1 giây (mức phóng to)
let userZoomed = false;   // người dùng đã tự lăn chuột phóng to/thu nhỏ chưa

function showView(v) {
  $('home').hidden = v !== 'home';
  $('editor').hidden = v !== 'editor';
  $('backBtn').hidden = v !== 'editor';
  $('openDir').hidden = v === 'editor';
  api.invoke('win:layout', v).catch(() => {});
  if (v === 'home') { stopPlay(); vid.removeAttribute('src'); vid.load(); cur = null; loadRecent(); }
  refreshFoot();
}
$('backBtn').onclick = () => showView('home');

const newSeg = (s, e, t) => ({ id: ++segSeq, s, e, t });
const segLen = g => g.e - g.s;
const segEnd = g => g.t + segLen(g);
const ordered = () => segs.slice().sort((a, b) => a.t - b.t);
const total = () => segs.reduce((m, g) => Math.max(m, segEnd(g)), 0);
const keptLen = () => segs.reduce((t, g) => t + segLen(g), 0);
const segAt = t => segs.find(g => t >= g.t - 1e-6 && t < segEnd(g) - 1e-6) || null;
const pos = () => P;
function pushHist() { hist.push(JSON.stringify({ segs, selId })); if (hist.length > 100) hist.shift(); }
function undo() {
  const h = hist.pop(); if (!h) return;
  const o = JSON.parse(h); segs = o.segs; selId = o.selId;
  renderSegs(true); seekTo(P);
}

async function openEditor(file) {
  const info = await api.invoke('media:open', file).catch(() => null);
  if (!info) { toast('Không mở được file này', 'error'); return; }
  cur = info;
  showView('editor');
  const isImg = info.isGif;
  $('gifImg').hidden = !isImg; $('vwrap').hidden = isImg;
  $('ctrl').classList.toggle('off', isImg); $('timeline').classList.toggle('off', isImg);
  $('mp4Grp').hidden = isImg; $('gifGrp').hidden = isImg;
  if (isImg) $('gifImg').src = info.url; else { vid.src = info.url; vid.load(); }
  segs = [newSeg(0, info.duration || 0, 0)]; selId = null; hist = []; P = 0; playing = false; renderPlay();
  $('iName').textContent = info.name; $('iName').title = info.name;
  $('iSize').textContent = info.width ? `${info.width} × ${info.height}` : '—';
  $('iFps').textContent = info.fps || '—';
  $('iDur').textContent = fmtTc(info.duration);
  $('iBytes').textContent = fmtB(info.size);
  $('owRow').hidden = !/\.mp4$/i.test(info.file);
  $('overwrite').checked = false;
  stripUrl = null; userZoomed = false;
  requestAnimationFrame(() => { fitZoom(); renderSegs(true); seekTo(0); });
  const n = Math.max(8, Math.round(tl.clientWidth / 90));
  if (!isImg) api.invoke('media:strip', info.src, n).then(u => { if (u && cur === info) { stripUrl = u; renderSegs(true); } });
}

vid.addEventListener('loadedmetadata', () => {
  if (cur && isFinite(vid.duration) && (!cur.duration || Math.abs(vid.duration - cur.duration) > 0.5)) {
    const old = cur.duration; cur.duration = vid.duration; $('iDur').textContent = fmtTc(vid.duration);
    if (segs.length === 1 && segs[0].s === 0 && Math.abs(segs[0].e - old) < 0.01) segs[0].e = vid.duration;
    fitZoom(); renderSegs(true);
  }
});
$('volume').oninput = () => { vid.volume = $('volume').value / 100; };
vid.volume = .8;

function renderPlay() { $('playBtn').innerHTML = icon(playing ? 'pause' : 'play'); }
renderPlay();

// --- phóng to / thu nhỏ timeline (không tự co lại khi xoá/tỉa đoạn) ---
const tl = $('tl'), tlc = $('tlc'), track = $('track');
function fitZoom() {
  const W = tl.clientWidth - 24, d = Math.max(1, total() || (cur && cur.duration) || 1);
  pps = Math.max(2, W / d);
}
function contentWidth() { return Math.max(tl.clientWidth, (Math.max(total(), (cur && cur.duration) || 0) + 3) * pps + 40); }
function zoomAt(factor, clientX) {
  const r = tl.getBoundingClientRect(), mx = clientX - r.left;
  const t = (tl.scrollLeft + mx) / pps;
  const minP = (tl.clientWidth - 24) / Math.max(1, Math.max(total(), (cur && cur.duration) || 1) * 1.5);
  pps = Math.min(600, Math.max(Math.min(2, minP), pps * factor));
  renderSegs(true);
  tl.scrollLeft = t * pps - mx;
}
function buildRuler() {
  const r = $('ruler'); r.innerHTML = '';
  const W = contentWidth();
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(x => x * pps >= 70) || 600;
  const sub = step / 5;
  for (let k = 0; k * sub * pps <= W; k++) {
    const t = Math.round(k * sub * 1000) / 1000, x = t * pps, major = k % 5 === 0;
    const tick = document.createElement('i'); tick.style.left = x + 'px'; tick.style.height = major ? '8px' : '4px'; r.appendChild(tick);
    if (major) {
      const sp = document.createElement('span'); sp.style.setProperty('--x', x + 'px');
      sp.textContent = step < 1 ? fmtTc(t).slice(0, 7) : fmtDur(t);
      if (t === 0) sp.style.setProperty('--x', '14px');
      r.appendChild(sp);
    }
  }
}

// --- vẽ các đoạn ---
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
function placeEl(g, t) {
  const el = segEl(g), srcD = (cur && cur.duration) || 1, w = segLen(g) * pps;
  el.style.width = Math.max(6, w - 2) + 'px';
  el.style.transform = `translateX(${(t ?? g.t) * pps + 1}px)`;
  if (stripUrl) {
    const bw = srcD * pps;
    el.style.backgroundImage = `url("${stripUrl}")`;
    el.style.backgroundSize = `${bw}px 100%`;
    el.style.backgroundPosition = `${-g.s * pps}px 0`;
  } else el.style.backgroundImage = '';
}
function renderSegs(instant) {
  tlc.style.width = contentWidth() + 'px';
  const ids = new Set(segs.map(g => String(g.id)));
  track.querySelectorAll('.segk').forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });
  ordered().forEach((g, i) => {
    const el = segEl(g);
    el.classList.toggle('on', g.id === selId);
    el.querySelector('.lab').textContent = `Đoạn ${i + 1} · ${fmtDur(g.s)}–${fmtDur(g.e)}`;
    el.querySelector('.dur').textContent = segLen(g).toFixed(1) + 's';
    if (instant) el.style.transition = 'none';
    if (!(act && act.type === 'move' && act.g === g)) placeEl(g);
  });
  if (instant) requestAnimationFrame(() => track.querySelectorAll('.segk').forEach(el => el.style.transition = ''));
  buildRuler();
  const T = total(), gaps = Math.max(0, T - keptLen());
  $('tcDur').textContent = fmtTc(T);
  $('iTotal').textContent = fmtTc(T);
  $('iCount').textContent = segs.length;
  $('segInfo').innerHTML = `${segs.length} đoạn · tổng <b>${fmtTc(T)}</b>` + (gaps > 0.05 ? ` · khoảng trống <b>${gaps.toFixed(1)}s</b> (hình đen)` : '');
  $('delSegBtn').disabled = !selId || segs.length < 2;
  $('undoBtn').disabled = !hist.length;
  renderGifEst();
}
addEventListener('resize', () => { if (cur && !$('editor').hidden) { if (!userZoomed) fitZoom(); renderSegs(true); } });

function renderGifEst() {
  if (!cur) return;
  const fps = gifFps(), sc = gifScale() / 100, d = total();
  const est = (cur.width || 800) * (cur.height || 450) * sc * sc * fps * d * 0.09;
  $('saveGif').lastChild.textContent = `Xuất GIF (~${fmtB(est)})`;
}

// --- phát thử: chạy theo đồng hồ timeline; trong đoạn thì phát video, chỗ trống thì màn đen ---
function showFrameAt(t) {
  const g = segAt(t);
  $('gapCover').hidden = !!g;
  if (g) { const want = g.s + (t - g.t); if (Math.abs(vid.currentTime - want) > 0.04) vid.currentTime = want; }
  return g;
}
function seekTo(t) {
  P = Math.max(0, Math.min(total(), t));
  if (!playing) { vid.pause(); showFrameAt(P); }
  else syncPlay(true);
}
let playSeg = null;
function syncPlay(force) {
  const g = segAt(P);
  $('gapCover').hidden = !!g;
  if (!g) { if (!vid.paused) vid.pause(); playSeg = null; return; }
  const want = g.s + (P - g.t);
  if (force || playSeg !== g || Math.abs(vid.currentTime - want) > 0.25) vid.currentTime = want;
  playSeg = g;
  if (vid.paused) vid.play().catch(() => {});
}
function startPlay() { if (P >= total() - 0.03) P = 0; playing = true; lastTick = performance.now(); renderPlay(); syncPlay(true); }
function stopPlay() { playing = false; playSeg = null; vid.pause(); renderPlay(); }
function togglePlay() { if (!cur || $('vwrap').hidden) return; playing ? stopPlay() : startPlay(); }
(function loop(now) {
  if (cur && playing) {
    const dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
    const g = segAt(P);
    if (g && playSeg === g && !vid.paused) P = g.t + (vid.currentTime - g.s);   // trong đoạn: theo video
    else P += dt;                                                               // chỗ trống: theo đồng hồ
    if (g && P >= segEnd(g) - 0.02) P = segEnd(g);
    if (P >= total() - 0.01) { P = total(); stopPlay(); showFrameAt(Math.max(0, P - 0.01)); }
    else syncPlay(false);
    // vạch đỏ ra khỏi khung nhìn thì cuộn theo
    const x = P * pps;
    if (x < tl.scrollLeft || x > tl.scrollLeft + tl.clientWidth - 30) tl.scrollLeft = x - 40;
  } else lastTick = now;
  if (cur) { $('ph').style.left = P * pps + 'px'; $('tcCur').textContent = fmtTc(P); }
  requestAnimationFrame(loop);
})(performance.now());
$('playBtn').onclick = togglePlay;
$('player').onclick = togglePlay;
$('toIn').onclick = () => seekTo(0);
$('toOut').onclick = () => seekTo(total());

// --- thao tác đoạn ---
function splitAt() {
  if (!cur) return;
  const g = segAt(P);
  if (!g) { toast('Vạch đỏ đang ở chỗ trống, hãy đưa vào giữa 1 đoạn'); return; }
  const src = g.s + (P - g.t);
  if (src - g.s < 0.1 || g.e - src < 0.1) { toast('Đưa vạch đỏ vào giữa đoạn để cắt'); return; }
  pushHist();
  const a = newSeg(g.s, src, g.t), b = newSeg(src, g.e, P);
  segs.splice(segs.indexOf(g), 1, a, b);
  selId = b.id;
  renderSegs(true);
  segEl(b).classList.add('pop'); setTimeout(() => segEl(b).classList.remove('pop'), 300);
}
function deleteSel() {
  const i = segs.findIndex(g => g.id === selId);
  if (i < 0) return;
  if (segs.length < 2) { toast('Phải còn ít nhất 1 đoạn'); return; }
  pushHist();
  segs.splice(i, 1);                 // để lại khoảng trống, không tự dồn
  selId = null;
  renderSegs(false);
  seekTo(Math.min(P, total()));
}
$('splitBtn').onclick = splitAt;
$('delSegBtn').onclick = deleteSel;
$('undoBtn').onclick = undo;
$('resetCut').onclick = () => { if (!cur) return; pushHist(); segs = [newSeg(0, cur.duration, 0)]; selId = null; fitZoom(); renderSegs(true); seekTo(0); };

// --- hít (snap) & chống chồng đoạn ---
const SNAP_PX = 10;
function snapPoints(except) {
  const pts = [0, P];
  segs.forEach(g => { if (g !== except) pts.push(g.t, segEnd(g)); });
  return pts;
}
function snapMove(g, t) {           // t: vị trí đề xuất cho đầu đoạn
  const len = segLen(g), lim = SNAP_PX / pps;
  let best = null;
  for (const p of snapPoints(g)) {
    for (const [edge, nt] of [[t, p], [t + len, p - len]]) {
      const d = Math.abs(edge - p);
      if (d <= lim && (!best || d < best.d)) best = { d, t: nt, at: p };
    }
  }
  return best ? { t: Math.max(0, best.t), at: best.at } : { t: Math.max(0, t), at: null };
}
function overlaps(g, t) { const e = t + segLen(g); return segs.some(o => o !== g && t < segEnd(o) - 1e-3 && e > o.t + 1e-3); }
function freeSpot(g, t) {           // nếu chồng lên đoạn khác: đặt sát mép gần nhất còn trống
  if (!overlaps(g, t)) return t;
  const len = segLen(g), cands = [];
  segs.forEach(o => { if (o !== g) { cands.push(segEnd(o)); if (o.t - len >= 0) cands.push(o.t - len); } });
  cands.sort((a, b) => Math.abs(a - t) - Math.abs(b - t));
  return cands.find(c => !overlaps(g, c)) ?? null;
}
function showSnap(at) { const l = $('snapLine'); if (at == null) { l.hidden = true; return; } l.hidden = false; l.style.left = at * pps + 'px'; }

// --- chuột trên timeline ---
function timeAt(x) { const r = tl.getBoundingClientRect(); return Math.max(0, (x - r.left + tl.scrollLeft) / pps); }
let act = null;
tl.addEventListener('contextmenu', e => e.preventDefault());
tl.addEventListener('wheel', e => { if (!cur) return; e.preventDefault(); userZoomed = true; zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX); }, { passive: false });
tl.addEventListener('pointerdown', e => {
  if (!cur) return;
  tl.setPointerCapture(e.pointerId);
  if (e.button === 2 || e.button === 1) { act = { type: 'pan', sx: e.clientX, sl: tl.scrollLeft }; tl.classList.add('panning'); return; }
  if (e.button !== 0) return;
  const el = e.target.closest('.segk');
  const g = el && segs.find(x => String(x.id) === el.dataset.id);
  if (g && e.target.classList.contains('sg')) {               // tỉa mép
    pushHist(); stopPlay();
    act = { type: 'trim', g, el, side: e.target.classList.contains('l') ? 's' : 'e', sx: e.clientX, o: { ...g } };
    el.classList.add('trimming');
    return;
  }
  if (g) { act = { type: 'press', g, el, sx: e.clientX, t: timeAt(e.clientX) }; return; }
  act = { type: 'seek' }; stopPlay(); seekTo(timeAt(e.clientX));
});
tl.addEventListener('pointermove', e => {
  if (!act) return;
  if (act.type === 'pan') { tl.scrollLeft = act.sl - (e.clientX - act.sx); return; }
  if (act.type === 'seek') { seekTo(timeAt(e.clientX)); return; }
  if (act.type === 'trim') { trimMove(act, e); return; }
  if (act.type === 'press' && Math.abs(e.clientX - act.sx) > 4) startMove(act, e);
  if (act.type === 'move') moveMove(act, e);
});
tl.addEventListener('pointerup', () => {
  const a = act; act = null;
  if (!a) return;
  tl.classList.remove('panning');
  if (a.type === 'trim') { a.el.classList.remove('trimming'); showSnap(null); renderSegs(true); seekTo(P); }
  else if (a.type === 'press') { selId = a.g.id; stopPlay(); seekTo(a.t); renderSegs(false); }
  else if (a.type === 'move') endMove(a, false);
});
tl.addEventListener('pointercancel', () => { if (act && act.type === 'move') endMove(act, true); act = null; tl.classList.remove('panning'); });

function trimMove(a, e) {
  const { g, o, side } = a, srcD = cur.duration, dt = (e.clientX - a.sx) / pps;
  const ord = ordered(), i = ord.indexOf(g), prev = ord[i - 1], next = ord[i + 1];
  if (side === 's') {            // tỉa đầu: mép phải đứng yên
    let ns = Math.min(o.e - 0.1, Math.max(0, o.s + dt));
    let nt = o.t + (ns - o.s);
    const minT = prev ? segEnd(prev) : 0;
    if (nt < minT) { ns += minT - nt; nt = minT; }
    const sn = snapPoints(g).find(p => Math.abs(p - nt) * pps <= SNAP_PX && p >= minT);
    if (sn != null && ns + (sn - nt) >= 0 && ns + (sn - nt) < o.e - 0.1) { ns += sn - nt; nt = sn; showSnap(sn); } else showSnap(null);
    g.s = ns; g.t = nt;
    vid.currentTime = g.s;
  } else {                       // tỉa cuối
    let ne = Math.max(o.s + 0.1, Math.min(srcD, o.e + dt));
    const maxEnd = next ? next.t : Infinity;
    if (g.t + (ne - g.s) > maxEnd) ne = g.s + (maxEnd - g.t);
    const end = g.t + (ne - g.s);
    const sn = snapPoints(g).find(p => Math.abs(p - end) * pps <= SNAP_PX && p <= maxEnd);
    if (sn != null && g.s + (sn - g.t) <= srcD && sn - g.t > 0.1) { ne = g.s + (sn - g.t); showSnap(sn); } else showSnap(null);
    g.e = ne;
    vid.currentTime = Math.max(0, g.e - 0.01);
  }
  $('gapCover').hidden = true;
  renderSegs(true);
}

// Kéo di chuyển đoạn: đi theo chuột, tự hít vào mép đoạn khác / đầu timeline / vạch đỏ;
// ô nét đứt cho biết chỗ sẽ đặt (không chồng lên đoạn khác)
function startMove(a, e) {
  pushHist(); stopPlay();
  a.type = 'move';
  a.grab = timeAt(e.clientX) - a.g.t;
  a.orig = a.g.t;
  selId = a.g.id;
  renderSegs(false);
  a.el.classList.add('lift');
  const sl = document.createElement('div'); sl.className = 'segslot'; track.appendChild(sl);
  moveMove(a, e);
}
function moveMove(a, e) {
  const raw = timeAt(e.clientX) - a.grab;
  const sn = snapMove(a.g, raw);
  showSnap(sn.at);
  a.el.style.transform = `translateX(${sn.t * pps + 1}px) translateY(-6px) scale(1.02)`;
  const spot = freeSpot(a.g, sn.t);
  a.spot = spot;
  a.el.classList.toggle('bad', spot == null);
  const sl = track.querySelector('.segslot');
  if (sl) {
    sl.hidden = spot == null;
    if (spot != null) { sl.style.width = Math.max(4, segLen(a.g) * pps - 2) + 'px'; sl.style.transform = `translateX(${spot * pps + 1}px)`; }
  }
  // kéo sát mép khung nhìn thì tự cuộn
  const r = tl.getBoundingClientRect();
  if (e.clientX > r.right - 30) tl.scrollLeft += 12; else if (e.clientX < r.left + 30) tl.scrollLeft -= 12;
}
function endMove(a, cancel) {
  const sl = track.querySelector('.segslot'); if (sl) sl.remove();
  showSnap(null);
  a.el.classList.remove('lift', 'bad');
  if (cancel || a.spot == null) a.g.t = a.orig; else a.g.t = a.spot;
  if (Math.abs(a.g.t - a.orig) < 1e-6) hist.pop();      // không đổi gì: không tính là 1 bước
  renderSegs(false);   // bay vào đúng chỗ
  a.el.classList.add('pop'); setTimeout(() => a.el.classList.remove('pop'), 300);
  seekTo(P);
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
  stopPlay();
  const ow = $('overwrite').checked && !$('owRow').hidden;
  if (ow) { vid.removeAttribute('src'); vid.load(); }
  const r = await api.invoke('media:trim', { src: cur.src, segs: segs.map(g => ({ s: g.s, e: g.e, t: g.t })), overwrite: ow, original: cur.file });
  if (!r.ok) { toast('Cắt bị lỗi: ' + r.error, 'error'); if (ow) openEditor(cur.file); return; }
  toast('Đã lưu ' + r.file.split(/[\\/]/).pop(), 'ok', { label: 'Mở thư mục', fn: () => api.invoke('files:openDir', r.file) });
  openEditor(r.file);
};
$('saveGif').onclick = async () => {
  if (!cur) return;
  stopPlay();
  const r = await api.invoke('media:gif', { src: cur.src, segs: segs.map(g => ({ s: g.s, e: g.e, t: g.t })), fps: gifFps(), scale: gifScale(), original: cur.file });
  if (!r.ok) { toast('Xuất GIF bị lỗi: ' + r.error, 'error'); return; }
  S.gifFps = gifFps(); S.gifScale = gifScale();
  toast('Đã xuất ' + r.file.split(/[\\/]/).pop(), 'ok', { label: 'Mở thư mục', fn: () => api.invoke('files:openDir', r.file) });
};
$('showFile').onclick = () => cur && api.invoke('files:openDir', cur.file);
$('delFile').onclick = async () => {
  if (!cur || !confirm('Xoá clip "' + cur.name + '"? File sẽ được chuyển vào Thùng rác.')) return;
  const f = cur.file;
  stopPlay(); vid.removeAttribute('src'); vid.load();
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
  else if (e.key === 'ArrowLeft') { stopPlay(); seekTo(pos() - (e.shiftKey ? 1 : fd)); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { stopPlay(); seekTo(pos() + (e.shiftKey ? 1 : fd)); e.preventDefault(); }
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

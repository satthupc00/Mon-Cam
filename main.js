const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, shell, session, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Recorder } = require('./lib/recorder');
const { run, probe } = require('./lib/ff');
const { joinFiles, muxSegment } = require('./lib/compose');
const { windowRect, hwndFromSourceId } = require('./lib/winrect');

const APP_TITLE = 'Mon Cam';
const HEADER_H = 58;
const isWin = process.platform === 'win32';

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- Cài đặt ----------
const userDir = app.getPath('userData');
const settingsFile = path.join(userDir, 'settings.json');
const DEFAULTS = {
  format: 'mp4', fps: 30, quality: 'medium', cursor: true, clickFx: false, audio: true,
  countdown: false, hideWhileRec: true, openEditorAfter: true,
  outDir: path.join(app.getPath('videos'), 'Mon Cam'),
  gifFps: 15, gifScale: 75, lastRegion: null, homeBounds: null, edBounds: null,
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
function saveSettings() {
  try { fs.mkdirSync(userDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch {}
}
const dirs = {
  thumbs: path.join(userDir, 'thumbs'),
  sources: path.join(userDir, 'gif-sources'),
  tmp: path.join(userDir, 'tmp'),
};
Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));

const preload = path.join(__dirname, 'preload.js');
const page = f => path.join(__dirname, 'src', f);
let win = null;

// ---------- Cửa sổ chính ----------
// Màn chính gọn; khi mở màn Xem lại & cắt thì cửa sổ nở rộng ra, quay về thì thu lại
const SIZES = {
  home: { w: 620, h: 560, minW: 520, minH: 480, key: 'homeBounds' },
  editor: { w: 1040, h: 700, minW: 860, minH: 580, key: 'edBounds' },
};
let layout = 'home';
function createMain() {
  const z = SIZES.home;
  const b = settings.homeBounds || {};
  win = new BrowserWindow({
    title: APP_TITLE, backgroundColor: '#1F2126',
    width: b.width || z.w, height: b.height || z.h, x: b.x, y: b.y, minWidth: z.minW, minHeight: z.minH,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1F2126', symbolColor: '#FFFFFF', height: HEADER_H },
    autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload, backgroundThrottling: false },
  });
  win.loadFile(page('index.html'));
  win.once('ready-to-show', () => win.show());
  const keep = () => {
    if (!win || win.isMinimized() || win.isMaximized() || win._resizing) return;
    settings[SIZES[layout].key] = win.getBounds();
    saveSettings();
  };
  win.on('resize', keep); win.on('move', keep);
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
function setLayout(mode) {
  if (!win || !SIZES[mode] || mode === layout) return;
  const old = win.getBounds();
  layout = mode;
  const z = SIZES[mode], saved = settings[z.key];
  if (win.isMaximized()) return;
  win._resizing = true;
  win.setMinimumSize(Math.min(z.minW, old.width), Math.min(z.minH, old.height));
  let w = saved ? saved.width : z.w, h = saved ? saved.height : z.h;
  // giữ tâm cửa sổ, không cho tràn khỏi màn hình
  const wa = screen.getDisplayMatching(old).workArea;
  w = Math.min(w, wa.width); h = Math.min(h, wa.height);
  let x = Math.round(old.x + (old.width - w) / 2), y = Math.round(old.y + (old.height - h) / 2);
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - w); y = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
  win.setBounds({ x, y, width: w, height: h }, true);
  win.setMinimumSize(z.minW, z.minH);
  setTimeout(() => { if (win) win._resizing = false; }, 400);
}
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
function showMain() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

app.on('second-instance', showMain);

// Âm thanh máy: getDisplayMedia trong cửa sổ chính trả về tiếng loopback của Windows
function setupAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(s => {
      try { cb(isWin ? { video: s[0], audio: 'loopback' } : { video: s[0] }); } catch {}
    }, () => { try { cb({}); } catch {} });
  });
}

// ---------- Toạ độ ----------
// Electron dùng toạ độ DIP; ffmpeg cần pixel thật của màn hình
function toPhysical(rect) {
  let r = rect;
  if (isWin) r = screen.dipToScreenRect(null, rect);
  else { const d = screen.getDisplayMatching(rect); const s = d.scaleFactor; r = { x: rect.x * s, y: rect.y * s, width: rect.width * s, height: rect.height * s }; }
  const x = Math.round(r.x), y = Math.round(r.y);
  let w = Math.round(r.width), h = Math.round(r.height);
  w -= w % 2; h -= h % 2;
  return { x, y, w: Math.max(2, w), h: Math.max(2, h) };
}

// ---------- Chọn vùng ----------
// Vùng đã chọn lần trước (nếu nằm trên màn này) để hiện sẵn khi chọn vùng mới
function lastRectOn(d) {
  const l = settings.lastRegion && settings.lastRegion.dip;
  if (!l) return null;
  const b = d.bounds;
  if (l.x < b.x || l.y < b.y || l.x + l.width > b.x + b.width || l.y + l.height > b.y + b.height) return null;
  return { x: l.x - b.x, y: l.y - b.y, w: l.width, h: l.height };
}
let overlays = [];
let selecting = null;
async function startSelection(opts = {}) {
  if (rec || selecting) return;
  selecting = true;
  const mainWasVisible = win && win.isVisible() && !win.isMinimized();
  if (win) win.hide();
  await new Promise(r => setTimeout(r, 250));
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor)));
  let sources = [];
  try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } }); } catch {}
  return new Promise(resolve => {
    const done = res => {
      const list = overlays; overlays = [];
      list.forEach(o => { if (!o.isDestroyed()) o.destroy(); });
      selecting = null;
      ipcMain.removeAllListeners('sel:done'); ipcMain.removeAllListeners('sel:cancel'); ipcMain.removeAllListeners('sel:clear-others'); ipcMain.removeAllListeners('shot:done');
      if (!res && mainWasVisible) showMain();
      if (res) res.mainWasVisible = mainWasVisible;
      resolve(res);
    };
    ipcMain.on('sel:done', (e, r) => {
      const d = displays.find(x => x.id === r.displayId) || screen.getPrimaryDisplay();
      const dip = { x: d.bounds.x + r.rect.x, y: d.bounds.y + r.rect.y, width: r.rect.width, height: r.rect.height };
      settings.cursor = r.cursor; settings.audio = r.audio; saveSettings();
      send('settings', settings);
      done({ dip, phys: toPhysical(dip), full: !!r.full });
    });
    ipcMain.on('sel:cancel', () => done(null));
    ipcMain.on('shot:done', (e, r) => done({ shot: r }));
    ipcMain.on('sel:clear-others', e => overlays.forEach(o => { if (!o.isDestroyed() && o.webContents !== e.sender) o.webContents.send('sel:clear'); }));
    displays.forEach((d, i) => {
      const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[i];
      const o = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, transparent: false, backgroundColor: '#000000', resizable: false, movable: false,
        skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, show: false, hasShadow: false, enableLargerThanScreen: true,
        webPreferences: { preload },
      });
      o.setAlwaysOnTop(true, 'screen-saver');
      o.setBounds(d.bounds);
      o.loadFile(page('overlay.html'));
      o.webContents.once('did-finish-load', () => {
        o.webContents.send('sel:init', {
          displayId: d.id, scale: d.scaleFactor, w: d.bounds.width, h: d.bounds.height,
          img: src ? src.thumbnail.toDataURL() : null, shot: !!opts.shot,
          cursor: settings.cursor, audio: settings.audio, gif: settings.format === 'gif',
          primary: d.id === screen.getPrimaryDisplay().id,
          cursorHere: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id === d.id,
          last: opts.shot ? null : lastRectOn(d),
        });
        o.show();
        if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id === d.id) o.focus();
      });
      overlays.push(o);
    });
  });
}

// ---------- Cửa sổ phụ khi quay ----------
let frameWin = null, barWin = null, fxWin = null;
function makeFloat(bounds, file, opts = {}) {
  const w = new BrowserWindow({
    ...bounds, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: !!opts.focusable, hasShadow: false, show: false, fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: { preload, backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  if (opts.protect !== false) w.setContentProtection(true); // không lọt vào video
  if (opts.clickThrough) w.setIgnoreMouseEvents(true);
  w.loadFile(page(file));
  w.once('ready-to-show', () => w.showInactive());
  return w;
}
function closeFloats() {
  [frameWin, barWin, fxWin].forEach(w => { if (w && !w.isDestroyed()) w.destroy(); });
  frameWin = barWin = fxWin = null;
}

function placeBar(dip) {
  const W = 430, H = 46;
  const d = dip ? screen.getDisplayMatching(dip) : screen.getPrimaryDisplay();
  const wa = d.workArea;
  let x, y;
  if (!dip) { x = wa.x + (wa.width - W) / 2; y = wa.y + 8; }
  else {
    x = Math.min(Math.max(dip.x, wa.x + 4), wa.x + wa.width - W - 4);
    y = dip.y - H - 8;
    if (y < wa.y) y = dip.y + dip.height + 8;
    if (y + H > wa.y + wa.height) y = Math.max(wa.y + 8, dip.y + 8); // vùng chiếm cả màn: đặt bên trong (đã chặn ghi hình)
  }
  return { x: Math.round(x), y: Math.round(y), width: W, height: H };
}

// ---------- Quay ----------
let rec = null;        // { r: Recorder, dip, fmt, audio, aSegs:[{t,file}], id, timer }

// Lệnh thu tiếng gửi sang cửa sổ chính (open → start/stop từng đoạn → close)
function audioCall(cmd) {
  return new Promise(resolve => {
    const id = Math.random().toString(36).slice(2);
    const t = setTimeout(() => { ipcMain.removeAllListeners('audio:reply:' + id); resolve({ ok: false }); }, 6000);
    ipcMain.once('audio:reply:' + id, (e, res) => { clearTimeout(t); resolve(res); });
    send('audio:cmd', { cmd, id });
  });
}
async function audioSegStart() {
  const a = await audioCall('start');
  rec.aSegs.push({ t: a.ok ? a.t : 0, file: null });
}
async function audioSegStop(cur) {
  const a = await audioCall('stop');
  const last = cur.aSegs[cur.aSegs.length - 1];
  if (last && a.ok && a.file) last.file = a.file;
}

async function beginRecording(sel) {
  if (rec) return;
  const fmt = settings.format;
  const target = sel.title ? { title: sel.title } : sel.phys;
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const r = new Recorder({ target, fps: Math.min(60, settings.fps), cursor: settings.cursor, quality: settings.quality, gif: fmt === 'gif', tmpDir: path.join(dirs.tmp, id) });
  rec = { r, dip: sel.dip, fmt, audio: fmt === 'mp4' && settings.audio, aSegs: [], id };

  if (settings.hideWhileRec && win) win.minimize();
  else if (win && !win.isVisible()) win.showInactive();

  // Khung đỏ ngoài vùng quay
  if (sel.dip && !sel.full) {
    const m = 4;
    frameWin = makeFloat({ x: sel.dip.x - m, y: sel.dip.y - m, width: sel.dip.width + m * 2, height: sel.dip.height + m * 2 }, 'frame.html', { clickThrough: true });
  }
  if (settings.clickFx && sel.dip) startClickFx(sel.dip);

  if (settings.countdown) {
    const d = sel.dip || screen.getPrimaryDisplay().bounds;
    const cw = makeFloat({ x: Math.round(d.x + d.width / 2 - 90), y: Math.round(d.y + d.height / 2 - 90), width: 180, height: 180 }, 'countdown.html', { clickThrough: true });
    await new Promise(res => setTimeout(res, 3200));
    if (!cw.isDestroyed()) cw.destroy();
    if (!rec) return;
  }

  barWin = makeFloat(placeBar(sel.full ? null : sel.dip), 'recbar.html', { focusable: true });

  try {
    if (rec.audio) {
      const o = await audioCall('open');
      if (o.ok) await audioSegStart();
      else { rec.audio = false; notify('Không thu được âm thanh máy, video sẽ không có tiếng'); }
    }
    await r.start();
  } catch (e) {
    await abortRec();
    showMain();
    notify('Không bắt đầu quay được: ' + shortErr(e), 'error');
    return;
  }
  r.on('crash', () => { notify('Bản quay bị ngắt giữa chừng, đã lưu phần trước đó', 'error'); stopRecording(); });
  rec.timer = setInterval(pushRecState, 250);
  pushRecState();
}

function recState() {
  if (!rec) return { state: 'idle' };
  return {
    state: rec.r.state, ms: rec.r.elapsed(), bytes: rec.r.bytes(),
    fmt: rec.fmt.toUpperCase(), fps: settings.fps, audio: rec.audio,
  };
}
function pushRecState() {
  const s = recState();
  if (barWin && !barWin.isDestroyed()) barWin.webContents.send('rec:state', s);
  if (frameWin && !frameWin.isDestroyed()) frameWin.webContents.send('rec:state', s);
  send('rec:state', s);
}

async function togglePause() {
  if (!rec || rec.busy) return;
  const cur = rec;
  cur.busy = true;
  try {
    if (cur.r.state === 'recording') {
      await Promise.all([cur.audio ? audioSegStop(cur) : null, cur.r.pause()]);
    } else if (cur.r.state === 'paused') {
      if (cur.audio) await audioSegStart();
      await cur.r.resume();
    }
  } catch (e) { notify('Lỗi khi tiếp tục quay: ' + shortErr(e), 'error'); }
  cur.busy = false;
  pushRecState();
}

async function abortRec() {
  if (!rec) return;
  const cur = rec; rec = null;
  clearInterval(cur.timer);
  stopClickFx(); closeFloats();
  if (cur.audio) audioCall('cancel');
  await cur.r.cancel();
  cur.aSegs.forEach(a => { if (a.file) try { fs.rmSync(a.file, { force: true }); } catch {} });
  send('rec:state', { state: 'idle' });
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function uniquePath(dir, base, ext) {
  let f = path.join(dir, base + ext), i = 2;
  while (fs.existsSync(f)) f = path.join(dir, `${base}_${i++}${ext}`);
  return f;
}

async function stopRecording() {
  if (!rec || rec.r.state === 'stopping') return;
  const cur = rec;
  clearInterval(cur.timer);
  stopClickFx(); closeFloats();
  showMain();
  send('busy', { text: 'Đang lưu bản quay…' });
  const tmpDir = path.join(dirs.tmp, cur.id);
  try {
    const wasRec = cur.r.state === 'recording';
    if (cur.audio && wasRec) await audioSegStop(cur);
    if (cur.audio) audioCall('close');
    const segs = await cur.r.stop();
    rec = null;
    send('rec:state', { state: 'idle' });
    fs.mkdirSync(settings.outDir, { recursive: true });
    const base = 'MonCam_' + stamp();
    let out, source;
    if (cur.fmt === 'gif') {
      source = uniquePath(dirs.sources, base, '.mp4');
      await joinFiles(segs.map(s => s.file), source, tmpDir);
      out = uniquePath(settings.outDir, base, '.gif');
      const info = await probe(source);
      send('busy', { text: 'Đang tạo GIF…', p: 0 });
      await makeGif(source, out, 0, info.duration, settings.gifFps, settings.gifScale, p => send('busy', { text: 'Đang tạo GIF…', p }));
    } else {
      out = uniquePath(settings.outDir, base, '.mp4');
      let parts = segs.map(s => s.file);
      if (cur.audio && cur.aSegs.some(a => a.file)) {
        parts = [];
        for (let i = 0; i < segs.length; i++) {
          const o = path.join(tmpDir, `av_${String(i).padStart(3, '0')}.mp4`);
          await muxSegment(segs[i], cur.aSegs[i], o);
          parts.push(o);
        }
      }
      await joinFiles(parts, out, tmpDir);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    cur.aSegs.forEach(a => { if (a.file) try { fs.rmSync(a.file, { force: true }); } catch {} });
    send('busy', null);
    send('rec:done', { file: out, source: source || out, open: settings.openEditorAfter });
  } catch (e) {
    rec = null;
    send('busy', null);
    send('rec:state', { state: 'idle' });
    notify('Lưu bản quay bị lỗi: ' + shortErr(e), 'error');
  }
}

function notify(text, kind) { send('toast', { text, kind }); }
function shortErr(e) { return String(e && e.message || e).split('\n').filter(Boolean).slice(-1)[0].slice(0, 160); }

// ---------- Hiệu ứng click (tuỳ chọn) ----------
let hook = null;
function startClickFx(dip) {
  try {
    if (!hook) hook = require('uiohook-napi');
  } catch { notify('Máy này chưa hỗ trợ hiệu ứng click'); return; }
  fxWin = makeFloat({ x: dip.x, y: dip.y, width: dip.width, height: dip.height }, 'clickfx.html', { clickThrough: true, protect: false });
  hook.uIOhook.removeAllListeners('mousedown');
  hook.uIOhook.on('mousedown', ev => {
    if (!fxWin || fxWin.isDestroyed()) return;
    const p = isWin ? screen.screenToDipPoint({ x: ev.x, y: ev.y }) : { x: ev.x, y: ev.y };
    fxWin.webContents.send('fx:click', { x: p.x - dip.x, y: p.y - dip.y, right: ev.button === 2 });
  });
  try { hook.uIOhook.start(); } catch {}
}
function stopClickFx() {
  if (hook) { try { hook.uIOhook.stop(); } catch {} hook.uIOhook.removeAllListeners('mousedown'); }
}

// ---------- Bắt đầu theo chế độ ----------
async function startMode(mode, extra) {
  if (rec || selecting) return;
  if (mode === 'region') {
    const sel = await startSelection();
    if (!sel) return;
    if (!sel.full) { settings.lastRegion = sel; saveSettings(); }
    return beginRecording(sel);
  }
  if (mode === 'last' && settings.lastRegion) {
    const s = settings.lastRegion;
    return beginRecording({ dip: s.dip, phys: toPhysical(s.dip) });
  }
  if (mode === 'last') return startMode('region');
  if (mode === 'fullscreen') {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return beginRecording({ dip: d.bounds, phys: toPhysical(d.bounds), full: true });
  }
  if (mode === 'window' && extra) return recordWindow(extra);
}

// Quay 1 cửa sổ = quay đúng khung của cửa sổ đó trên màn hình (chụp được cả trình duyệt,
// app dùng card đồ hoạ — kiểu chụp thẳng cửa sổ qua GDI chỉ ra màu trắng)
async function recordWindow(extra) {
  const hwnd = hwndFromSourceId(extra.id);
  if (!isWin || !hwnd) { notify('Chế độ quay cửa sổ chỉ chạy trên Windows', 'error'); return; }
  let r;
  try { r = await windowRect(hwnd); } catch (e) { notify('Không lấy được cửa sổ: ' + shortErr(e), 'error'); return; }
  let dip = screen.screenToDipRect(null, r);
  const d = screen.getDisplayMatching(dip).bounds;   // cắt phần nằm ngoài màn hình
  const x1 = Math.max(dip.x, d.x), y1 = Math.max(dip.y, d.y);
  const x2 = Math.min(dip.x + dip.width, d.x + d.width), y2 = Math.min(dip.y + dip.height, d.y + d.height);
  if (x2 - x1 < 16 || y2 - y1 < 16) { notify('Cửa sổ này đang nằm ngoài màn hình', 'error'); return; }
  dip = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  const full = dip.width >= d.width - 2 && dip.height >= d.height - 2;
  return beginRecording({ dip, phys: toPhysical(dip), full });
}

// ---------- Chụp ảnh ----------
// Chọn vùng + vẽ ghi chú ngay trên màn chọn vùng, xong thì copy vào bộ nhớ tạm (không lưu file)
async function startShot() {
  if (rec || selecting) return;
  const res = await startSelection({ shot: true });
  if (!res || !res.shot) return;
  const img = nativeImage.createFromDataURL(res.shot.url);
  if (img.isEmpty()) { if (res.mainWasVisible) showMain(); notify('Chụp ảnh bị lỗi', 'error'); return; }
  clipboard.writeImage(img);
  if (res.mainWasVisible && win) win.showInactive();
  showShotToast(res.shot);
}
let shotToast = null;
function showShotToast(shot) {
  if (shotToast && !shotToast.isDestroyed()) shotToast.destroy();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const W = 300, H = 86;
  const t = makeFloat({ x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16, width: W, height: H }, 'shottoast.html', { clickThrough: true });
  shotToast = t;
  t.webContents.once('did-finish-load', () => t.webContents.send('toast:data', { url: shot.url, w: shot.w, h: shot.h }));
  setTimeout(() => { if (!t.isDestroyed()) t.destroy(); }, 2600);
}

// ---------- Phím tắt ----------
let shotKeyOk = true;
function registerKeys() {
  globalShortcut.unregisterAll();
  globalShortcut.register('F12', () => { if (rec) stopRecording(); else startMode('last'); });
  globalShortcut.register('Shift+F12', togglePause);
  globalShortcut.register('CommandOrControl+Shift+R', () => { if (!rec) startMode('region'); });
  shotKeyOk = globalShortcut.register('PrintScreen', startShot);
  globalShortcut.register('CommandOrControl+Shift+S', startShot);   // phím dự phòng khi PrtSc bị Windows giữ
}

// ---------- Danh sách file ----------
function thumbFor(file) {
  const st = fs.statSync(file);
  const key = Buffer.from(file).toString('base64url').slice(-60) + '_' + Math.round(st.mtimeMs) + '.jpg';
  return path.join(dirs.thumbs, key);
}
async function ensureThumb(file) {
  const t = thumbFor(file);
  if (!fs.existsSync(t)) {
    const info = await probe(file);
    const at = Math.min(1, (info && info.duration || 0) / 2);
    await run(['-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', t]).catch(() => {});
  }
  return fs.existsSync(t) ? pathToFileURL(t).href : null;
}
function gifSourceOf(file) {
  const s = path.join(dirs.sources, path.basename(file, '.gif') + '.mp4');
  return fs.existsSync(s) ? s : null;
}

async function makeGif(src, out, start, end, fps, scale, onP) {
  const dur = Math.max(0.1, end - start);
  fps = Math.min(50, fps);
  const s = Math.max(10, Math.min(100, scale)) / 100;
  const vf = `fps=${fps},scale=trunc(iw*${s}/2)*2:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  const tmp = out + '.part.gif';
  await run(['-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', src, '-vf', vf, '-loop', '0', tmp],
    { onTime: t => onP && onP(Math.min(1, t / dur)) });
  fs.renameSync(tmp, out);
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (e, patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('whatsnew', () => { try { return JSON.parse(fs.readFileSync(page('whatsnew.json'), 'utf8')); } catch { return null; } });

  ipcMain.handle('rec:start', (e, mode, extra) => { startMode(mode, extra); });
  ipcMain.handle('win:layout', (e, mode) => setLayout(mode));
  ipcMain.handle('shot:start', () => { startShot(); });
  ipcMain.handle('shot:keyOk', () => shotKeyOk);
  ipcMain.handle('rec:pause', togglePause);
  ipcMain.handle('rec:stop', stopRecording);
  ipcMain.handle('rec:cancel', async () => { await abortRec(); showMain(); notify('Đã huỷ bản quay'); });
  ipcMain.handle('rec:state', recState);

  ipcMain.handle('windows:list', async () => {
    const own = new Set(BrowserWindow.getAllWindows().map(w => w.getMediaSourceId()));
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 } });
    return list.filter(s => !own.has(s.id) && s.name && s.name !== APP_TITLE)
      .map(s => ({ id: s.id, title: s.name, img: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }));
  });

  ipcMain.handle('files:list', async () => {
    let names = [];
    try { names = fs.readdirSync(settings.outDir).filter(n => /\.(mp4|gif)$/i.test(n)); } catch {}
    const items = names.map(n => { const f = path.join(settings.outDir, n); const st = fs.statSync(f); return { file: f, name: n, mtime: st.mtimeMs, size: st.size }; })
      .sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    return items;
  });
  ipcMain.handle('files:thumb', (e, f) => ensureThumb(f).catch(() => null));
  ipcMain.handle('files:free', async () => {
    try { const s = await fs.promises.statfs(settings.outDir); return s.bavail * s.bsize; } catch { return null; }
  });
  ipcMain.handle('files:openDir', (e, f) => { if (f) shell.showItemInFolder(f); else { fs.mkdirSync(settings.outDir, { recursive: true }); shell.openPath(settings.outDir); } });
  ipcMain.handle('files:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outDir });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.outDir = r.filePaths[0]; saveSettings(); return settings.outDir;
  });
  ipcMain.handle('files:delete', async (e, f) => {
    try { await shell.trashItem(f); } catch { try { fs.rmSync(f); } catch {} }
    const s = /\.gif$/i.test(f) && gifSourceOf(f); if (s) { try { fs.rmSync(s); } catch {} }
    return true;
  });

  // Mở 1 clip để xem lại: GIF thì mở file mp4 gốc của nó (nếu còn)
  ipcMain.handle('media:open', async (e, f) => {
    const src = /\.gif$/i.test(f) ? (gifSourceOf(f) || f) : f;
    const info = await probe(src);
    let size = 0; try { size = fs.statSync(f).size; } catch {}
    return { file: f, src, url: pathToFileURL(src).href + '?t=' + Date.now(), isGif: /\.gif$/i.test(src), name: path.basename(f), size, ...info };
  });
  ipcMain.handle('media:strip', async (e, src, n) => {
    const info = await probe(src);
    const out = path.join(dirs.thumbs, 'strip_' + Date.now() + '.jpg');
    const fps = Math.max(0.01, n / Math.max(0.1, info.duration));
    await run(['-i', src, '-an', '-vf', `fps=${fps.toFixed(4)},scale=-2:72,tile=${n}x1`, '-frames:v', '1', out]).catch(() => {});
    return fs.existsSync(out) ? pathToFileURL(out).href : null;
  });
  ipcMain.handle('media:trim', async (e, { src, start, end, overwrite, original }) => {
    const dur = Math.max(0.05, end - start);
    const keep = original && /\.mp4$/i.test(original) ? original : src;
    const out = overwrite && /\.mp4$/i.test(keep) ? keep + '.part.mp4'
      : uniquePath(settings.outDir, path.basename(keep).replace(/\.(mp4|gif)$/i, '') + '_cut', '.mp4');
    send('busy', { text: 'Đang cắt…', p: 0 });
    try {
      await run(['-ss', start.toFixed(3), '-i', src, '-t', dur.toFixed(3), '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', out], { onTime: t => send('busy', { text: 'Đang cắt…', p: Math.min(1, t / dur) }) });
      let final = out;
      if (overwrite && out.endsWith('.part.mp4')) { fs.renameSync(out, keep); final = keep; }
      return { ok: true, file: final };
    } catch (err) { try { fs.rmSync(out, { force: true }); } catch {} return { ok: false, error: shortErr(err) }; }
    finally { send('busy', null); }
  });
  ipcMain.handle('media:gif', async (e, { src, start, end, fps, scale, original }) => {
    settings.gifFps = fps; settings.gifScale = scale; saveSettings();
    const base = path.basename(original || src).replace(/\.(mp4|gif)$/i, '');
    const out = uniquePath(settings.outDir, base + (original && /\.gif$/i.test(original) ? '_cut' : ''), '.gif');
    send('busy', { text: 'Đang xuất GIF…', p: 0 });
    try {
      await makeGif(src, out, start, end, fps, scale, p => send('busy', { text: 'Đang xuất GIF…', p }));
      // Giữ lại mp4 gốc để GIF mới cũng mở xem lại được
      if (/\.mp4$/i.test(src)) {
        const s = path.join(dirs.sources, path.basename(out, '.gif') + '.mp4');
        if (!fs.existsSync(s)) await run(['-ss', start.toFixed(3), '-i', src, '-t', (end - start).toFixed(3), '-c', 'copy', s]).catch(() => {});
      }
      return { ok: true, file: out };
    } catch (err) { return { ok: false, error: shortErr(err) }; }
    finally { send('busy', null); }
  });

  // Ghi file tiếng từ cửa sổ chính
  ipcMain.handle('audio:write', (e, buf) => {
    const f = path.join(dirs.tmp, 'audio_' + Date.now() + '.webm');
    fs.writeFileSync(f, Buffer.from(buf));
    return f;
  });
}

// ---------- Tự cập nhật ----------
let updater = null;
function setupUpdater() {
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => send('upd', { state: 'checking' }));
  updater.on('update-available', i => send('upd', { state: 'available', version: i.version }));
  updater.on('update-not-available', () => send('upd', { state: 'latest' }));
  updater.on('download-progress', p => send('upd', { state: 'downloading', p: p.percent / 100 }));
  updater.on('update-downloaded', i => send('upd', { state: 'ready', version: i.version }));
  updater.on('error', err => send('upd', { state: 'error', error: shortErr(err) }));
  ipcMain.handle('upd:check', () => {
    if (!app.isPackaged) { send('upd', { state: 'latest', dev: true }); return; }
    return updater.checkForUpdates().catch(err => send('upd', { state: 'error', error: shortErr(err) }));
  });
  ipcMain.handle('upd:download', () => updater.downloadUpdate().catch(err => send('upd', { state: 'error', error: shortErr(err) })));
  ipcMain.handle('upd:install', () => { setImmediate(() => updater.quitAndInstall(true, true)); });
}

app.whenReady().then(() => {
  setupIpc();
  setupUpdater();
  setupAudioCapture();
  createMain();
  registerKeys();
  if (app.isPackaged && updater) setTimeout(() => updater.checkForUpdates().catch(() => {}), 3000);
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopClickFx(); });
app.on('window-all-closed', () => app.quit());

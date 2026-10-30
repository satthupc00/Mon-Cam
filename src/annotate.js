// Vẽ ghi chú lên ảnh chụp: mũi tên, khung, chữ, bút vẽ, bút tô sáng, làm mờ.
// Toạ độ lưu theo DIP của cửa sổ chọn vùng; khi xuất ảnh thì nhân theo độ phân giải thật.
const Ann = {
  tool: null, color: '#FF0000', size: 0, items: [], cur: null, img: null, textEl: null,
  K: [1, 2, 3.3],          // độ dày nét theo 3 nấc: mảnh / dày / rất dày
  TS: [22, 32, 46],        // cỡ chữ theo 3 nấc
  canvas: null, ctx: null, sel: () => null, onChange: () => {},

  init(img, getSel, onChange) {
    this.img = img; this.sel = getSel; this.onChange = onChange || (() => {});
    this.canvas = document.getElementById('ann');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },
  resize() {
    const r = devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * r); this.canvas.height = Math.round(innerHeight * r);
    this.redraw();
  },

  inside(x, y) { const s = this.sel(); return s && x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h; },

  down(e) {
    if (!this.tool || !this.inside(e.clientX, e.clientY)) return false;
    const x = e.clientX, y = e.clientY, c = this.color, k = this.K[this.size];
    if (this.tool === 'text') { this.startText(x, y); return true; }
    if (this.tool === 'pen' || this.tool === 'hl') this.cur = { t: this.tool, pts: [[x, y]], c, k };
    else this.cur = { t: this.tool, x1: x, y1: y, x2: x, y2: y, c, k };
    this.redraw();
    return true;
  },
  move(e) {
    if (!this.cur) return false;
    const x = e.clientX, y = e.clientY;
    if (this.cur.pts) this.cur.pts.push([x, y]);
    else if (e.shiftKey && (this.cur.t === 'rect' || this.cur.t === 'blur')) {   // Shift = hình vuông
      const d = Math.max(Math.abs(x - this.cur.x1), Math.abs(y - this.cur.y1));
      this.cur.x2 = this.cur.x1 + d * Math.sign(x - this.cur.x1 || 1);
      this.cur.y2 = this.cur.y1 + d * Math.sign(y - this.cur.y1 || 1);
    } else { this.cur.x2 = x; this.cur.y2 = y; }
    this.redraw();
    return true;
  },
  up() {
    if (!this.cur) return false;
    const c = this.cur; this.cur = null;
    const big = c.pts ? c.pts.length > 1 : Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1) > 4;
    if (big) { this.items.push(c); this.onChange(); }
    this.redraw();
    return true;
  },
  undo() { if (this.textEl) return this.cancelText(); this.items.pop(); this.redraw(); this.onChange(); },

  // --- chữ ---
  startText(x, y) {
    this.commitText();
    const t = document.createElement('div');
    t.className = 'ann-text'; t.contentEditable = 'plaintext-only';
    const fs = this.TS[this.size];
    t.style.left = x + 'px'; t.style.top = (y - fs * .65) + 'px'; t.style.color = this.color; t.style.fontSize = fs + 'px'; t.dataset.fs = fs;
    document.body.appendChild(t);
    this.textEl = t;
    setTimeout(() => t.focus(), 0);
    t.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.cancelText(); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.commitText(); }
    });
    t.addEventListener('blur', () => setTimeout(() => this.commitText(), 0));
  },
  commitText() {
    const t = this.textEl; if (!t) return;
    this.textEl = null;
    const s = t.innerText.replace(/\s+$/, '');
    if (s) {
      const r = t.getBoundingClientRect();
      this.items.push({ t: 'text', x: r.left + 6, y: r.top + 4, s, c: t.style.color, size: +t.dataset.fs || 22 });
      this.onChange();
    }
    t.remove(); this.redraw();
  },
  cancelText() { const t = this.textEl; this.textEl = null; if (t) t.remove(); },

  // --- vẽ ---
  redraw() {
    const g = this.ctx, r = devicePixelRatio || 1, s = this.sel();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s) return;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.save();
    g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip();
    this.render(g, [...this.items, ...(this.cur ? [this.cur] : [])]);
    g.restore();
  },
  render(g, list) {
    const kx = this.img ? this.img.naturalWidth / innerWidth : 1, ky = this.img ? this.img.naturalHeight / innerHeight : 1;
    for (const it of list) {
      g.save();
      g.strokeStyle = g.fillStyle = it.c; g.lineCap = 'round'; g.lineJoin = 'round';
      if (it.t === 'rect') {
        g.lineWidth = 3 * (it.k || 1); g.strokeRect(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1));
      } else if (it.t === 'arrow') {
        const k = it.k || 1, w = 4 * k, ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), hl = 18 * (1 + (k - 1) * .6), len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
        const bx = it.x2 - Math.cos(ang) * Math.min(hl * .8, len), by = it.y2 - Math.sin(ang) * Math.min(hl * .8, len);
        g.lineWidth = w; g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(bx, by); g.stroke();
        g.beginPath(); g.moveTo(it.x2, it.y2);
        g.lineTo(it.x2 - hl * Math.cos(ang - .45), it.y2 - hl * Math.sin(ang - .45));
        g.lineTo(it.x2 - hl * Math.cos(ang + .45), it.y2 - hl * Math.sin(ang + .45));
        g.closePath(); g.fill(); g.lineWidth = 2; g.stroke();
      } else if (it.t === 'pen' || it.t === 'hl') {
        g.lineWidth = (it.t === 'hl' ? 18 : 3) * (it.k || 1);
        if (it.t === 'hl') { g.globalAlpha = .38; g.lineCap = 'butt'; }
        g.beginPath(); it.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      } else if (it.t === 'blur') {
        const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
        if (w < 2 || h < 2 || !this.img) { g.restore(); continue; }
        const cell = 12, tw = Math.max(1, Math.round(w / cell)), th = Math.max(1, Math.round(h / cell));
        const off = document.createElement('canvas'); off.width = tw; off.height = th;
        off.getContext('2d').drawImage(this.img, x * kx, y * ky, w * kx, h * ky, 0, 0, tw, th);
        g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, tw, th, x, y, w, h);
      } else if (it.t === 'text') {
        g.font = `700 ${it.size}px "Segoe UI", system-ui, sans-serif`; g.textBaseline = 'top';
        const dark = /#111|17, 17, 17/i.test(it.c);   // chữ đen thì viền sáng, còn lại viền tối mỏng
        g.lineWidth = Math.max(2.5, it.size / 12); g.strokeStyle = dark ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.5)';
        it.s.split('\n').forEach((line, i) => { g.strokeText(line, it.x, it.y + i * it.size * 1.25); g.fillText(line, it.x, it.y + i * it.size * 1.25); });
      }
      g.restore();
    }
  },

  // Xuất ảnh vùng chọn (độ phân giải thật) kèm ghi chú
  export() {
    this.commitText();
    const s = this.sel(), img = this.img;
    const kx = img.naturalWidth / innerWidth, ky = img.naturalHeight / innerHeight;
    const W = Math.max(1, Math.round(s.w * kx)), H = Math.max(1, Math.round(s.h * ky));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, s.x * kx, s.y * ky, s.w * kx, s.h * ky, 0, 0, W, H);
    g.setTransform(kx, 0, 0, ky, -s.x * kx, -s.y * ky);
    this.render(g, this.items);
    return { url: c.toDataURL('image/png'), w: W, h: H };
  },
};

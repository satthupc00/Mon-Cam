// Quay màn hình bằng ffmpeg gdigrab. Mỗi lần tạm dừng = kết thúc 1 đoạn,
// tiếp tục = mở đoạn mới; khi dừng hẳn trả về các đoạn để ghép tiếng rồi nối.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { ffmpegPath } = require('./ff');

const CRF = { low: 30, medium: 24, high: 18 };

class Recorder extends EventEmitter {
  // opts: { target:{x,y,w,h}|{title}, fps, cursor, quality, tmpDir }
  constructor(opts) {
    super();
    this.o = opts;
    this.segs = [];
    this.times = [];       // lúc mỗi đoạn bắt đầu ghi
    this.proc = null;
    this.state = 'idle';     // idle | recording | paused | stopping
    this.activeMs = 0;       // thời gian quay của các đoạn đã xong
    this.segStart = 0;       // lúc đoạn hiện tại bắt đầu ghi thật
    fs.mkdirSync(opts.tmpDir, { recursive: true });
  }

  elapsed() {
    return this.activeMs + (this.state === 'recording' && this.segStart ? Date.now() - this.segStart : 0);
  }

  bytes() {
    let n = 0;
    for (const f of this.segs) { try { n += fs.statSync(f).size; } catch {} }
    return n;
  }

  args(file) {
    const { target, fps, cursor, quality, gif } = this.o;
    const a = ['-hide_banner', '-y', '-f', 'gdigrab', '-thread_queue_size', '1024',
      '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0'];
    if (target.title) a.push('-i', 'title=' + target.title);
    else a.push('-offset_x', String(target.x), '-offset_y', String(target.y),
      '-video_size', `${target.w}x${target.h}`, '-i', 'desktop');
    a.push('-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264', '-preset', fps >= 60 ? 'ultrafast' : 'superfast',
      '-crf', String(gif ? 16 : (CRF[quality] || 24)), '-g', String(fps * 2),
      '-r', String(fps), file);
    return a;
  }

  // Mở 1 đoạn mới, resolve khi ffmpeg đã bắt đầu ghi
  _openSeg() {
    return new Promise((resolve, reject) => {
      const file = path.join(this.o.tmpDir, `seg_${String(this.segs.length).padStart(3, '0')}.mp4`);
      const p = spawn(ffmpegPath(), this.args(file), { windowsHide: true });
      this.proc = p;
      let log = '', started = false;
      p.stderr.on('data', d => {
        log = (log + d).slice(-4000);
        if (!started && /Press \[q\]|frame=/.test(log)) {
          started = true;
          // gdigrab đóng dấu khung hình bằng giờ thật: "start: <giây epoch>" = lúc khung đầu tiên được chụp
          const m = /start: (\d+\.\d+)/.exec(log);
          const t = m && +m[1] > 1e9 ? Math.round(+m[1] * 1000) : Date.now();
          this.segs.push(file);
          this.times.push(t);
          resolve(t);
        }
      });
      p.on('error', e => { if (!started) reject(e); });
      p.on('close', code => {
        this.proc = null;
        if (!started) reject(new Error(code === null ? 'Không mở được ffmpeg' : log.split('\n').slice(-4).join('\n')));
        else if (this.state === 'recording') { this.state = 'paused'; this.emit('crash', log); }
        this.emit('segclosed');
      });
    });
  }

  _closeSeg() {
    const p = this.proc;
    if (!p) return Promise.resolve();
    return new Promise(resolve => {
      const t = setTimeout(() => { try { p.kill(); } catch {} }, 5000);
      p.once('close', () => { clearTimeout(t); resolve(); });
      try { p.stdin.write('q'); } catch { try { p.kill(); } catch {} }
    });
  }

  async start() {
    const t = await this._openSeg();
    this.segStart = t;
    this.state = 'recording';
    return t;
  }

  async pause() {
    if (this.state !== 'recording') return;
    this.activeMs += Date.now() - this.segStart;
    this.segStart = 0;
    this.state = 'paused';
    await this._closeSeg();
  }

  async resume() {
    if (this.state !== 'paused') return;
    this.segStart = await this._openSeg();
    this.state = 'recording';
    return this.segStart;
  }

  // Dừng hẳn, trả về danh sách đoạn [{file, t}]
  async stop() {
    if (this.state === 'recording') this.activeMs += Date.now() - this.segStart;
    this.state = 'stopping';
    await this._closeSeg();
    const segs = this.segs.map((file, i) => ({ file, t: this.times[i] }))
      .filter(s => { try { return fs.statSync(s.file).size > 1024; } catch { return false; } });
    if (!segs.length) throw new Error('Không có dữ liệu video');
    return segs;
  }

  async cancel() {
    this.state = 'stopping';
    if (this.proc) { try { this.proc.kill(); } catch {} }
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(this.o.tmpDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { Recorder };

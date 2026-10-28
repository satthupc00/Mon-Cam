// Bọc ffmpeg: tìm file chạy, chạy lệnh, đọc thông tin video
const { spawn } = require('child_process');

let ffPath = null;
function ffmpegPath() {
  if (ffPath) return ffPath;
  try {
    ffPath = require('ffmpeg-static');
    if (ffPath) ffPath = ffPath.replace('app.asar' + require('path').sep, 'app.asar.unpacked' + require('path').sep);
  } catch { ffPath = null; }
  if (!ffPath) ffPath = 'ffmpeg';
  return ffPath;
}

function parseTime(s) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// Chạy ffmpeg tới khi xong. onTime(giây) được gọi theo tiến độ.
function run(args, { onTime, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => {
      const s = d.toString();
      err = (err + s).slice(-6000);
      if (onTime) { const m = /time=(\S+)/.exec(s); if (m) onTime(parseTime(m[1])); }
    });
    if (signal) signal.addEventListener('abort', () => { try { p.kill(); } catch {} });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(err) : reject(new Error('ffmpeg lỗi (' + code + '):\n' + err.split('\n').slice(-6).join('\n'))));
  });
}

// Lấy thời lượng, kích thước, fps
function probe(file) {
  return new Promise(resolve => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    let out = '';
    p.stderr.on('data', d => out += d);
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const dur = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(out);
      const v = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
      const fps = /(\d+(?:\.\d+)?) fps/.exec(out) || /(\d+(?:\.\d+)?) tbr/.exec(out);
      resolve({
        duration: dur ? parseTime(dur[1]) : 0,
        width: v ? +v[1] : 0, height: v ? +v[2] : 0,
        fps: fps ? Math.round(parseFloat(fps[1])) : 0,
        hasAudio: /Stream #.*Audio:/.test(out),
      });
    });
  });
}

module.exports = { ffmpegPath, run, probe, parseTime };

// Ghép tiếng + nối các đoạn quay
const fs = require('fs');
const path = require('path');
const { run, probe } = require('./ff');

// Nối nhiều file cùng thông số, không render lại
async function joinFiles(files, out, tmpDir) {
  if (files.length === 1) return run(['-i', files[0], '-c', 'copy', '-movflags', '+faststart', out]);
  const list = path.join(tmpDir, 'list.txt');
  fs.writeFileSync(list, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  return run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
}

// Ghép tiếng vào từng đoạn hình: căn theo lúc bắt đầu của mỗi đoạn,
// thiếu thì đệm im lặng, thừa thì cắt — nên tạm dừng nhiều lần cũng không lệch dồn
async function muxSegment(seg, aSeg, out) {
  const info = await probe(seg.file);
  const d = Math.max(0.05, info && info.duration || 0).toFixed(3);
  if (aSeg && aSeg.file) {
    const off = (seg.t - aSeg.t) / 1000; // >0: tiếng bắt đầu sớm hơn hình
    const af = (off >= 0 ? `atrim=start=${off.toFixed(3)},asetpts=PTS-STARTPTS` : `adelay=${Math.round(-off * 1000)}:all=1`)
      + `,aresample=48000,apad=whole_dur=${d},atrim=end=${d}`;
    return run(['-i', seg.file, '-i', aSeg.file, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', af, '-c:a', 'aac', '-b:a', '192k', '-ac', '2', out]);
  }
  return run(['-i', seg.file, '-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', out]);
}

module.exports = { joinFiles, muxSegment };

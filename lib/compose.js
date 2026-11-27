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

// Gắn ảnh bìa (1 khung hình, JPG) vào MP4 kiểu Siêu nét (4:4:4). Windows Explorer không giải mã được 4:4:4
// nên không tạo được thumbnail → có ảnh bìa thì Explorer lấy ảnh bìa làm thumbnail. Video giữ nguyên, không nén lại.
async function addCover(file, { force = false } = {}) {
  try {
    const info = await probe(file);
    if (!info || info.cover || (!force && info.pix !== 'yuv444p')) return false;
    const at = Math.min(1, Math.max(0, (info.duration || 0) / 2)).toFixed(3);
    const jpg = file + '.cover.jpg', tmp = file + '.cover.mp4';
    await run(['-ss', at, '-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2:flags=lanczos,format=yuvj420p", '-q:v', '3', jpg]);
    await run(['-i', file, '-i', jpg, '-map', '0:v:0', '-map', '0:a?', '-map', '1', '-c', 'copy', '-c:v:1', 'mjpeg',
      '-disposition:v:1', 'attached_pic', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
  finally { for (const f of [file + '.cover.jpg', file + '.cover.mp4']) try { fs.rmSync(f, { force: true }); } catch {} }
}

module.exports = { joinFiles, muxSegment, addCover };

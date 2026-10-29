// Ghép các đoạn video theo timeline (có khoảng trống đen) → MP4 / GIF
const fs = require('fs');
const { run, probe } = require('./ff');
const { BT709 } = require('./recorder');

// Các đoạn [{s,e,t}]: s,e = giây trong clip gốc, t = vị trí bắt đầu trên timeline.
// Ghép theo thứ tự t; chỗ trống giữa các đoạn thành hình đen + im lặng.
function segsEnd(segs) { return segs.reduce((m, g) => Math.max(m, g.t + (g.e - g.s)), 0); }
function buildParts(segs) {
  const parts = []; let cur = 0;
  segs.slice().sort((a, b) => a.t - b.t).forEach(g => {
    if (g.t - cur > 0.02) parts.push({ gap: g.t - cur });
    parts.push({ seg: g });
    cur = Math.max(cur, g.t + (g.e - g.s));
  });
  return parts;
}
// Dựng lệnh ffmpeg: mỗi đoạn là 1 input (-ss/-t để tua nhanh), khoảng trống là nguồn màu đen + im lặng
async function partsGraph(src, segs, { audio = true, tail = '' } = {}) {
  const info = (await probe(src)) || {};
  const W = info.width || 1280, H = info.height || 720, F = info.fps || 30;
  const hasA = audio && !!info.hasAudio;
  const parts = buildParts(segs), inputs = [];
  let fc = '', cat = '', k = 0;
  parts.forEach((p, i) => {
    if (p.seg) {
      const g = p.seg;
      inputs.push('-ss', g.s.toFixed(3), '-t', Math.max(0.05, g.e - g.s).toFixed(3), '-i', src);
      fc += `[${k}:v:0]setpts=PTS-STARTPTS,fps=${F},scale=${W}:${H},setsar=1,format=yuv420p[v${i}];`;
      if (hasA) fc += `[${k}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}];`;
      k++;
    } else {
      const d = p.gap.toFixed(3);
      fc += `color=c=black:s=${W}x${H}:r=${F}:d=${d},setsar=1,format=yuv420p[v${i}];`;
      if (hasA) fc += `anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${i}];`;
    }
    cat += `[v${i}]` + (hasA ? `[a${i}]` : '');
  });
  fc += `${cat}concat=n=${parts.length}:v=1:a=${hasA ? 1 : 0}` + (tail ? `,${tail}` : '[v]') + (hasA && !tail ? '[a]' : '');
  return { inputs, fc, hasA, dur: segsEnd(segs) };
}

// Ghép thành MP4 (re-encode để cắt chính xác từng khung)
async function renderSegments(src, segs, out, { preset = 'veryfast', crf = 18, onP } = {}) {
  const g = await partsGraph(src, segs);
  await run([...g.inputs, '-filter_complex', g.fc, '-map', '[v]', ...(g.hasA ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', ...BT709, '-movflags', '+faststart', out],
    { onTime: t => onP && onP(Math.min(1, t / g.dur)) });
}

async function makeGif(src, out, segs, fps, scale, onP) {
  fps = Math.min(50, fps);
  const k = Math.max(10, Math.min(100, scale)) / 100;
  const g = await partsGraph(src, segs, { audio: false,
    tail: `fps=${fps},scale=trunc(iw*${k}/2)*2:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle` });
  const tmp = out + '.part.gif';
  await run([...g.inputs, '-filter_complex', g.fc, '-loop', '0', tmp], { onTime: t => onP && onP(Math.min(1, t / g.dur)) });
  fs.renameSync(tmp, out);
}
function cleanSegs(segs, start, end) {
  const list = Array.isArray(segs) && segs.length ? segs : [{ s: start, e: end, t: 0 }];
  let acc = 0;
  return list.map(g => {
    const s0 = Math.max(0, +g.s || 0), e0 = +g.e || 0;
    const t = isFinite(+g.t) && g.t !== undefined ? Math.max(0, +g.t) : acc;   // thiếu t: xếp nối tiếp
    acc = t + (e0 - s0);
    return { s: s0, e: e0, t };
  }).filter(g => g.e - g.s >= 0.05);
}

module.exports = { renderSegments, makeGif, cleanSegs, buildParts };

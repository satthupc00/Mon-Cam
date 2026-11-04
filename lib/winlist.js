// Danh sách khung các cửa sổ đang mở (pixel thật, theo thứ tự từ trên xuống) để "bắt dính" khi chọn vùng.
// Giữ sẵn 1 tiến trình PowerShell chạy nền (đã biên dịch phần Win32) → mỗi lần hỏi chỉ mất vài chục ms.
const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class MonE {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RC r, int s);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetInt(IntPtr h, int a, out int v, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
  public static string Run() {
    var o = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h) || GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;              // cửa sổ công cụ (toolwindow)
      int cloak; if (DwmGetInt(h, 14, out cloak, 4) == 0 && cloak != 0) return true;   // bị ẩn (app UWP nền)
      RC r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true;   // khung thật, bỏ bóng đổ
      if (r.R - r.L < 40 || r.B - r.T < 40) return true;
      o.Add(r.L + " " + r.T + " " + r.R + " " + r.B);
      return true;
    }, IntPtr.Zero);
    return string.Join(";", o);
  }
}
'@
[MonE]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -eq 'list') { [Console]::Out.WriteLine('W:' + [MonE]::Run()); [Console]::Out.Flush() }
}
`;

let proc = null, buf = '', waiters = [];
function start() {
  if (process.platform !== 'win32') return null;
  if (proc && !proc.killed && proc.exitCode === null) return proc;
  const enc = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
  buf = '';
  proc.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('W:')) { const w = waiters.shift(); if (w) w(parse(line.slice(2))); }
    }
  });
  proc.on('exit', () => { proc = null; waiters.splice(0).forEach(w => w([])); });
  proc.on('error', () => { proc = null; });
  return proc;
}
function parse(s) {
  return s.split(';').filter(Boolean).map(p => {
    const [l, t, r, b] = p.split(' ').map(Number);
    return { x: l, y: t, width: r - l, height: b - t };
  });
}
// Trả về [{x,y,width,height}] theo pixel thật, cửa sổ trên cùng đứng trước
function listWindows(timeout = 2500) {
  const p = start();
  if (!p) return Promise.resolve([]);
  return new Promise(resolve => {
    const t = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); resolve([]); }, timeout);
    function done(v) { clearTimeout(t); resolve(v); }
    waiters.push(done);
    try { p.stdin.write('list\n'); } catch { done([]); }
  });
}
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; } }

module.exports = { listWindows, warm: start, stop };

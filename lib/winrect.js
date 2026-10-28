// Lấy khung thật của 1 cửa sổ Windows (pixel thật, bỏ phần bóng đổ) và đưa nó lên trên cùng.
// Dùng PowerShell + Win32 nên không cần thêm module native.
const { execFile } = require('child_process');

const PS = (hwnd) => `
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public class MonW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RC r, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
}
'@
[MonW]::SetProcessDPIAware() | Out-Null
$h = [IntPtr]${hwnd}
if (-not [MonW]::IsWindow($h)) { 'GONE'; exit }
if ([MonW]::IsIconic($h)) { [MonW]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 350 }
[MonW]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 250
$r = New-Object MonW+RC
if ([MonW]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { [MonW]::GetWindowRect($h, [ref]$r) | Out-Null }
"$($r.L) $($r.T) $($r.R) $($r.B)"
`;

// sourceId của desktopCapturer có dạng "window:<HWND>:0"
function hwndFromSourceId(id) {
  const m = /^window:(\d+):/.exec(id || '');
  return m ? m[1] : null;
}

function windowRect(hwnd) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(PS(hwnd), 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, timeout: 15000 }, (err, out) => {
        const s = String(out || '').trim().split(/\r?\n/).pop() || '';
        if (s === 'GONE') return reject(new Error('Cửa sổ này đã đóng'));
        const n = s.split(/\s+/).map(Number);
        if (n.length !== 4 || n.some(isNaN)) return reject(err || new Error('Không đọc được vị trí cửa sổ'));
        resolve({ x: n[0], y: n[1], width: n[2] - n[0], height: n[3] - n[1] });
      });
  });
}

module.exports = { windowRect, hwndFromSourceId };

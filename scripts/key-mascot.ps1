Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class OrangeKey {
  public static void Run(string srcPath, string dstPath) {
    using (var loaded = new Bitmap(srcPath))
    using (var bmp = new Bitmap(loaded.Width, loaded.Height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) {
        g.DrawImage(loaded, 0, 0, loaded.Width, loaded.Height);
      }
      int w = bmp.Width, h = bmp.Height;
      var rect = new Rectangle(0, 0, w, h);
      var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int stride = data.Stride;
      byte[] px = new byte[Math.Abs(stride) * h];
      Marshal.Copy(data.Scan0, px, 0, px.Length);

      Func<int, double> Dist = (i) => {
        int b = px[i], gch = px[i + 1], r = px[i + 2];
        double dr = r - 255, dg = gch - 129, db = b - 5;
        return Math.Sqrt(dr * dr + dg * dg + db * db);
      };

      bool[] seen = new bool[w * h];
      var q = new Queue<int>();
      Action<int, int> tryEnq = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        int idx = y * w + x;
        if (seen[idx]) return;
        int i = y * stride + x * 4;
        if (Dist(i) > 110) return;
        seen[idx] = true;
        q.Enqueue(idx);
      };
      for (int x = 0; x < w; x++) { tryEnq(x, 0); tryEnq(x, h - 1); }
      for (int y = 0; y < h; y++) { tryEnq(0, y); tryEnq(w - 1, y); }

      int[] ox = { 1, -1, 0, 0, 1, 1, -1, -1 };
      int[] oy = { 0, 0, 1, -1, 1, -1, 1, -1 };
      while (q.Count > 0) {
        int idx = q.Dequeue();
        int x = idx % w, y = idx / w;
        int i = y * stride + x * 4;
        px[i + 3] = 0;
        for (int k = 0; k < 8; k++) tryEnq(x + ox[k], y + oy[k]);
      }

      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int i = y * stride + x * 4;
          if (px[i + 3] == 0) continue;
          double d = Dist(i);
          if (d < 108) px[i + 3] = 0;
          else if (d < 145) {
            int a = (int)Math.Max(0, Math.Min(255, (d - 95) * 5));
            if (a < px[i + 3]) px[i + 3] = (byte)a;
          }
        }
      }

      for (int y = 1; y < h - 1; y++) {
        for (int x = 1; x < w - 1; x++) {
          int i = y * stride + x * 4;
          if (px[i + 3] == 0) continue;
          bool nearClear = false;
          for (int k = 0; k < 8; k++) {
            int ni = (y + oy[k]) * stride + (x + ox[k]) * 4;
            if (px[ni + 3] == 0) { nearClear = true; break; }
          }
          if (!nearClear) continue;
          double d = Dist(i);
          if (d < 140) {
            int a = (int)Math.Max(0, Math.Min(255, (d - 70) * 4));
            px[i + 3] = (byte)a;
          }
        }
      }

      Marshal.Copy(px, 0, data.Scan0, px.Length);
      bmp.UnlockBits(data);
      bmp.Save(dstPath, ImageFormat.Png);
    }
  }
}
"@

$srcRoot = "C:\Users\Matthew\.cursor\projects\d-MediaManager\assets"
$dstRoot = "D:\MediaManager\src\renderer\src\assets\mascot"
New-Item -ItemType Directory -Force -Path $dstRoot | Out-Null
$names = @('midnight','nord','forest','sissy','blacked','hypnotic')
foreach ($name in $names) {
  $src = Join-Path $srcRoot "mascot-$name-orange.jpg"
  $dst = Join-Path $dstRoot "$name.png"
  Write-Host "key $name"
  [OrangeKey]::Run($src, $dst)
  Write-Host "  -> $dst"
}

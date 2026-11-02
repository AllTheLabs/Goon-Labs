// Renders build/icon.png (used by electron-builder). Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const dataUrl = await win.webContents.executeJavaScript(`(() => {
    const size = 512
    const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d')

    // Purple rounded square with a soft top-left highlight.
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#8b5cf6'); grad.addColorStop(1, '#6d28d9')
    g.fillStyle = grad
    g.beginPath(); g.roundRect(16, 16, size - 32, size - 32, 112); g.fill()
    const sheen = g.createRadialGradient(150, 110, 0, 150, 110, 340)
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)'); sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
    g.fillStyle = sheen
    g.beginPath(); g.roundRect(16, 16, size - 32, size - 32, 112); g.fill()

    // A single white water drop: pointed top, round bottom.
    const cx = size / 2, cy = 300, r = 118
    g.beginPath()
    g.moveTo(cx, 82)
    g.bezierCurveTo(cx + 40, 150, cx + r, 205, cx + r, cy)
    g.arc(cx, cy, r, 0, Math.PI, false)
    g.bezierCurveTo(cx - r, 205, cx - 40, 150, cx, 82)
    g.closePath()
    g.shadowColor = 'rgba(40, 10, 90, 0.35)'; g.shadowBlur = 24; g.shadowOffsetY = 10
    g.fillStyle = 'white'
    g.fill()
    return c.toDataURL('image/png')
  })()`)
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('wrote', out)
  app.exit(0)
})

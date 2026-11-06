;(() => {
  if (window.top !== window) return
  if (window.__goonlabsSave) {
    window.__goonlabsSave.scan()
    return
  }

  function challengeActive() {
    if (/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname)) return true
    if (location.pathname.includes('/cdn-cgi/challenge')) return true
    const title = document.title.toLowerCase()
    const interstitial =
      title.includes('just a moment') ||
      title.includes('verify you are human') ||
      title.includes('checking if the site connection is secure')
    if (!interstitial) return false
    return Boolean(
      document.getElementById('challenge-running') ||
        document.getElementById('challenge-form') ||
        document.querySelector('.cf-browser-verification, #cf-please-wait')
    )
  }

  function ddgHomeActive() {
    const host = location.hostname.replace(/^www\./i, '').toLowerCase()
    if (host !== 'duckduckgo.com' && host !== 'start.duckduckgo.com') return false
    const path = (location.pathname || '/').replace(/\/+$/, '') || '/'
    if (path !== '/') return false
    const query = new URLSearchParams(location.search).get('q')
    return !query || !query.trim()
  }

  function overlayBlocked() {
    return challengeActive() || ddgHomeActive()
  }

  function absUrl(raw) {
    if (!raw) return ''
    try {
      const href = new URL(raw, location.href).href
      return /^https?:\/\//i.test(href) ? href : ''
    } catch {
      return ''
    }
  }

  function isImageUrl(url) {
    return /\.(jpe?g|png|gif|webp|avif|bmp|jfif)(\?|#|$)/i.test(url)
  }

  function mediaSrc(el) {
    if (el.tagName === 'VIDEO') {
      return absUrl(el.currentSrc || el.src || el.querySelector('source')?.src || '') || location.href
    }
    const linked = absUrl(el.closest?.('a[href]')?.href || '')
    if (linked && isImageUrl(linked)) return linked
    return absUrl(el.currentSrc || el.src)
  }

  function importUrls(urls, cb) {
    const api = window.goonlabs
    if (api && typeof api.import === 'function') {
      Promise.resolve(api.import(urls))
        .then((result) => cb(result || { ok: true }))
        .catch((err) => cb({ ok: false, error: String(err && err.message ? err.message : err) }))
      return
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'goonlabs-import', urls }, cb)
      return
    }
    cb({ ok: false, error: 'Goon Labs is not connected' })
  }

  const host = document.createElement('div')
  host.id = 'goonlabs-save-root'
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    button {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 5px 8px 5px 5px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      color: #f4f1ff;
      font: 700 13px/1 "Segoe UI", system-ui, sans-serif;
      background: rgba(16, 12, 28, 0.9);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      transition: transform 0.12s ease, background 0.12s ease;
    }
    button:hover { transform: translateY(-1px); background: rgba(28, 20, 48, 0.96); }
    button:disabled { cursor: default; transform: none; }
    .logo {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #8b5cf6, #6d28d9);
      color: #fff;
    }
    .plus {
      width: 20px;
      height: 20px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: linear-gradient(135deg, #8b5cf6, #5ab0ff);
      color: #fff;
      font-size: 16px;
      font-weight: 800;
    }
    button.busy .plus { font-size: 0; }
    button.busy .plus::after {
      content: "";
      width: 10px;
      height: 10px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    button.ok .plus { background: #3ecf8e; font-size: 12px; }
    button.err .plus { background: #ff6b6b; font-size: 12px; }
    .on-media { position: absolute; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `
  shadow.append(style)

  function droplet() {
    const wrap = document.createElement('span')
    wrap.className = 'logo'
    wrap.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s6 7.2 6 12a6 6 0 1 1-12 0C6 9.2 12 2 12 2z"/></svg>'
    return wrap
  }

  function makeButton(title) {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = title
    const plus = document.createElement('span')
    plus.className = 'plus'
    plus.textContent = '+'
    button.append(droplet(), plus)
    return { button, plus }
  }

  function bindImport(button, plus, urlsOf) {
    let locked = false
    const setState = (kind) => {
      button.classList.remove('busy', 'ok', 'err')
      if (kind === 'busy') {
        button.classList.add('busy')
        button.disabled = true
        plus.textContent = ''
      } else if (kind === 'ok') {
        button.classList.add('ok')
        button.disabled = true
        plus.textContent = '✓'
      } else if (kind === 'err') {
        button.classList.add('err')
        button.disabled = false
        plus.textContent = '!'
      } else {
        button.disabled = false
        plus.textContent = '+'
      }
    }
    button.addEventListener(
      'click',
      (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (locked) return
        const urls = urlsOf().filter(Boolean)
        if (urls.length === 0) return
        locked = true
        setState('busy')
        importUrls(urls, (result) => {
          const failed = Boolean(!result || result.ok === false)
          setState(failed ? 'err' : 'ok')
          button.title = failed ? result?.error || 'Save failed' : 'Saving into Pictures or Videos…'
          window.setTimeout(() => {
            locked = false
            button.title = 'Save this media to Goon Labs'
            setState('idle')
          }, failed ? 2400 : 1600)
        })
      },
      true
    )
  }

  const overlays = new Map()

  function decorate(el) {
    if (overlays.has(el)) return
    const kind = el.tagName === 'VIDEO' ? 'clip' : 'picture'
    const control = makeButton(`Save this ${kind} to Goon Labs`)
    control.button.className = 'on-media'
    bindImport(control.button, control.plus, () => {
      const src = mediaSrc(el)
      return src ? [src] : []
    })
    shadow.append(control.button)
    overlays.set(el, control.button)
  }

  function layout() {
    const blocked = overlayBlocked()
    host.style.display = blocked ? 'none' : 'block'
    if (blocked) return

    for (const [el, button] of [...overlays]) {
      if (!el.isConnected) {
        button.remove()
        overlays.delete(el)
        continue
      }
      const min = el.tagName === 'VIDEO' ? 40 : 80
      const rect = el.getBoundingClientRect()
      const visible =
        Boolean(mediaSrc(el)) &&
        rect.width >= min &&
        rect.height >= min &&
        rect.bottom > 8 &&
        rect.right > 8 &&
        rect.top < window.innerHeight - 8 &&
        rect.left < window.innerWidth - 8
      if (!visible) {
        button.style.display = 'none'
        continue
      }
      button.style.display = 'flex'
      const width = button.offsetWidth || 56
      button.style.top = `${Math.max(8, rect.top + 8)}px`
      button.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width - 8))}px`
    }
  }

  function scan() {
    if (!host.isConnected) {
      const root = document.documentElement || document.body
      if (root) root.appendChild(host)
    }
    if (overlayBlocked()) {
      layout()
      return
    }
    for (const video of document.querySelectorAll('video')) decorate(video)
    for (const image of document.querySelectorAll('img')) decorate(image)
    layout()
  }

  scan()
  let raf = 0
  const kick = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      scan()
    })
  }
  new MutationObserver(kick).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'class']
  })
  window.addEventListener('scroll', layout, true)
  window.addEventListener('resize', layout)
  for (const event of ['loadedmetadata', 'play', 'emptied']) {
    document.addEventListener(event, kick, true)
  }

  window.__goonlabsSave = { scan }
})()

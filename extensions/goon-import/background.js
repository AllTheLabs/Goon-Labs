chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'goonlabs-import') return
  const urls = Array.isArray(message.urls) ? message.urls.filter(Boolean) : []
  if (urls.length === 0) {
    sendResponse({ ok: false, error: 'Nothing to save on this page' })
    return
  }
  const endpoint = new URL('goonlabs://import/')
  for (const url of urls) endpoint.searchParams.append('url', url)
  fetch(endpoint.href)
    .then(async (response) => {
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) {
        sendResponse({ ok: false, error: body.error || 'Goon Labs could not start the download' })
        return
      }
      sendResponse({ ok: true, count: body.count ?? urls.length })
    })
    .catch(() => sendResponse({ ok: false, error: 'Could not reach Goon Labs' }))
  return true
})

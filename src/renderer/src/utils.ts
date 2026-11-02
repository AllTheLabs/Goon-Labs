import type { MediaItem } from '../../shared/types'

export function mediaUrl(item: MediaItem): string {
  const path = item.relPath.split('/').map(encodeURIComponent).join('/')
  // size + import time bust Chromium's cache when a file is replaced in place (trim, etc).
  return `media://item/${path}?v=${item.size}-${encodeURIComponent(item.importedAt)}`
}

export function previewUrl(item: MediaItem): string {
  return `media://item/.mediamanager/previews/${encodeURIComponent(item.id)}.mp4`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Timeline labels, with tenths of a second. */
export function formatTimecode(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = (total % 60).toFixed(1).padStart(4, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot + 1).toUpperCase() : ''
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Every http(s) link in a block of text, without trailing punctuation, de-duplicated. */
export function extractUrls(text: string): string[] {
  const urls = (text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map((url) => url.replace(/[),.;:!?\]]+$/, ''))
  return [...new Set(urls)]
}

export function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
}

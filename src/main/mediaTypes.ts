import path from 'node:path'
import type { MediaType } from '../shared/types'

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
}

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t'
}

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME).map((ext) => ext.slice(1))
export const VIDEO_EXTENSIONS = Object.keys(VIDEO_MIME).map((ext) => ext.slice(1))

export function mediaTypeOf(filePath: string): MediaType | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext in IMAGE_MIME) return 'image'
  if (ext in VIDEO_MIME) return 'video'
  return null
}

const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/vnd.microsoft.icon': '.ico',
  'image/x-ms-bmp': '.bmp',
  'video/x-m4v': '.m4v',
  'video/mp2t': '.mts'
}
for (const map of [IMAGE_MIME, VIDEO_MIME]) {
  for (const [ext, mime] of Object.entries(map)) EXTENSION_FOR_MIME[mime] ??= ext
}

/** The usual file extension (with the dot) for a photo or video MIME type, or null. */
export function extensionForMime(mime: string): string | null {
  return EXTENSION_FOR_MIME[mime.toLowerCase()] ?? null
}

export function mimeTypeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return IMAGE_MIME[ext] ?? VIDEO_MIME[ext] ?? 'application/octet-stream'
}

import type { MediaItem } from '../../shared/types'
import { MAX_SCROLLER_TILES } from './scrollerDecode'
export interface Tile {
  key: number
  item: MediaItem
  src: string
  /** width / height of the video as displayed. */
  aspect: number
}

export interface PlacedTile {
  tile: Tile
  x: number
  y: number
  width: number
  height: number
}

interface LayoutRow {
  /** Number of tiles in the row. */
  count: number
  height: number
  /** Whether the row's shape depended on the tile right after it (which must therefore be kept). */
  usedLookahead: boolean
}

export interface Layout {
  /** Complete rows only. */
  rows: LayoutRow[]
  /** Tiles in complete rows, followed by any leftover tiles at the target height. */
  placed: PlacedTile[]
  /** Height of the complete rows. */
  height: number
}

/**
 * Justified layout: rows are filled left to right with tiles at their true aspect ratio,
 * and each row's height is chosen so its tiles exactly span `width`, landing as close to
 * `targetHeight` as possible. Leftover tiles that can't yet fill a row are still placed
 * (below the complete rows) so they stay mounted and can start decoding while a resize
 * re-flows the grid; they wait there for more tiles to be appended.
 *
 * Rows are formed greedily from the start, so dropping the first row's tiles or appending
 * tiles at the end never changes the rows in between.
 */
export function justify(tiles: Tile[], width: number, targetHeight: number): Layout {
  const rows: LayoutRow[] = []
  const placed: PlacedTile[] = []
  let y = 0
  let start = 0

  while (start < tiles.length) {
    let end = start
    let aspectSum = 0
    while (end < tiles.length && aspectSum * targetHeight < width) {
      aspectSum += tiles[end].aspect
      end++
    }
    if (aspectSum * targetHeight < width) {
      let x = 0
      for (let i = start; i < end; i++) {
        const tileWidth = tiles[i].aspect * targetHeight
        placed.push({ tile: tiles[i], x, y, width: tileWidth, height: targetHeight })
        x += tileWidth
      }
      break
    }

    // The last tile overshot the width: drop it to the next row if that keeps this row
    // closer to the target height (i.e. less squashed).
    let usedLookahead = false
    if (end - start > 1) {
      const withoutLast = aspectSum - tiles[end - 1].aspect
      if (Math.abs(width / withoutLast - targetHeight) < Math.abs(width / aspectSum - targetHeight)) {
        end--
        aspectSum = withoutLast
        usedLookahead = true
      }
    }

    const height = width / aspectSum
    let x = 0
    for (let i = start; i < end; i++) {
      const tileWidth = tiles[i].aspect * height
      placed.push({ tile: tiles[i], x, y, width: tileWidth, height })
      x += tileWidth
    }
    rows.push({ count: end - start, height, usedLookahead })
    y += height
    start = end
  }

  return { rows, placed, height: y }
}

/** Viewport plus the row leaving at the top plus one full row waiting below the fold. */
function neededHeight(layout: Layout, viewportHeight: number, targetHeight: number): number {
  const leaving = layout.rows[0]?.height ?? targetHeight
  return viewportHeight + leaving + targetHeight
}

/**
 * Grows or trims the tile sequence so its complete rows cover the viewport, the row
 * partly scrolled off the top, and one extra row below the fold that can decode
 * before it becomes visible.
 */
export function fitTiles(
  tiles: Tile[],
  width: number,
  viewportHeight: number,
  targetHeight: number,
  makeTile: () => Tile
): Tile[] {
  let sequence = tiles
  for (let guard = 0; guard < 500; guard++) {
    const layout = justify(sequence, width, targetHeight)
    const needed = neededHeight(layout, viewportHeight, targetHeight)
    if (layout.height >= needed) return trimTo(sequence, layout, needed)
    if (sequence.length >= MAX_SCROLLER_TILES) return trimTo(sequence, layout, needed)
    sequence = [...sequence, makeTile(), makeTile()]
  }
  return sequence
}

function trimTo(sequence: Tile[], layout: Layout, needed: number): Tile[] {
  let covered = 0
  let keep = 0
  let lookahead = false
  for (const row of layout.rows) {
    if (covered >= needed) break
    covered += row.height
    keep += row.count
    lookahead = row.usedLookahead
  }
  // Keep the last row's lookahead tile, otherwise that row would re-form differently.
  const length = keep + (lookahead ? 1 : 0)
  return length >= sequence.length ? sequence : sequence.slice(0, length)
}

const aspectCache = new Map<string, number | null>()

function probeAspect(item: MediaItem, src: string): Promise<number | null> {
  const cacheKey = `${item.id}:${item.size}`
  if (aspectCache.has(cacheKey)) return Promise.resolve(aspectCache.get(cacheKey)!)
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (aspect: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      aspectCache.set(cacheKey, aspect)
      resolve(aspect)
    }
    const timer = setTimeout(() => finish(null), 10000)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () =>
      finish(video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null)
    video.onerror = () => finish(null)
    video.src = src
  })
}

/** Reads each video's dimensions (a few at a time). Unplayable videos are left out of the result. */
export async function probeAspects(
  items: MediaItem[],
  srcOf: (item: MediaItem) => string,
  onProgress: (done: number) => void
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const unknown: MediaItem[] = []
  for (const item of items) {
    if (item.width && item.height) {
      result.set(item.id, item.width / item.height)
    } else {
      unknown.push(item)
    }
  }
  onProgress(result.size)
  let next = 0
  let done = result.size
  const worker = async () => {
    while (next < unknown.length) {
      const item = unknown[next++]
      const aspect = await probeAspect(item, srcOf(item))
      if (aspect) result.set(item.id, aspect)
      onProgress(++done)
    }
  }
  if (unknown.length > 0) {
    await Promise.all(Array.from({ length: Math.min(3, unknown.length) }, worker))
  }
  return result
}

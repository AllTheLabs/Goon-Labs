import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import type { DiscordActivity } from '../shared/types'

/** Public Discord application id. The Discord app is named AllTheLabs. Not a secret. */
const CLIENT_ID = '1567198321322496070'
const RELEASES_URL = 'https://github.com/AllTheLabs/Goon-Labs/releases'
const RETRY_MS = 15_000

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

interface Client {
  path: string
  socket: Socket
  ready: boolean
}

let enabled = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let last: DiscordActivity = { lab: null, idle: false }
let lastLab: string | null = null
let labEnteredAt = 0
const clients = new Map<string, Client>()
const pending = new Set<string>()

function ipcPaths(): string[] {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  }
  const base = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? '/tmp'
  return Array.from({ length: 10 }, (_, i) => `${base}/discord-ipc-${i}`)
}

function encode(opcode: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const frame = Buffer.alloc(8 + json.length)
  frame.writeUInt32LE(opcode, 0)
  frame.writeUInt32LE(json.length, 4)
  json.copy(frame, 8)
  return frame
}

function attachDecoder(sock: Socket, onMessage: (opcode: number, data: unknown) => void): void {
  let buf = Buffer.alloc(0)
  sock.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8) {
      const opcode = buf.readUInt32LE(0)
      const length = buf.readUInt32LE(4)
      if (buf.length < 8 + length) break
      const body = buf.subarray(8, 8 + length).toString('utf8')
      buf = buf.subarray(8 + length)
      try {
        onMessage(opcode, JSON.parse(body) as unknown)
      } catch {
        /* Discord sent a frame we cannot parse — skip it. */
      }
    }
  })
}

function send(client: Client, opcode: number, payload: unknown): void {
  if (client.socket.destroyed) return
  client.socket.write(encode(opcode, payload))
}

function activityPayload(): Record<string, unknown> {
  const buttons = [{ label: 'GitHub Releases', url: RELEASES_URL }]
  const shared = { type: 0, name: 'AllTheLabs', buttons, instance: false }
  if (last.lab) {
    return {
      ...shared,
      details: `In Goon Session - ${last.lab}`,
      timestamps: { start: labEnteredAt }
    }
  }
  return {
    ...shared,
    details: last.idle ? 'Idle' : 'Browsing media'
  }
}

function setActivityFrame(): Record<string, unknown> {
  return {
    cmd: 'SET_ACTIVITY',
    nonce: randomUUID(),
    args: {
      pid: process.pid,
      activity: activityPayload()
    }
  }
}

function apply(): void {
  if (!enabled) return
  const frame = setActivityFrame()
  for (const client of clients.values()) {
    if (client.ready) send(client, OP_FRAME, frame)
  }
}

function dropClient(path: string): void {
  const client = clients.get(path)
  pending.delete(path)
  if (!client) return
  clients.delete(path)
  client.ready = false
  client.socket.removeAllListeners()
  client.socket.destroy()
}

function dropAll(): void {
  for (const path of [...clients.keys()]) dropClient(path)
  pending.clear()
}

function scheduleRetry(): void {
  if (!enabled || retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, RETRY_MS)
}

function wireSocket(client: Client): void {
  attachDecoder(client.socket, (opcode, data) => {
    if (opcode === OP_PING) {
      send(client, OP_PONG, data)
      return
    }
    if (opcode === OP_CLOSE) {
      dropClient(client.path)
      scheduleRetry()
      return
    }
    if (opcode !== OP_FRAME || !data || typeof data !== 'object') return
    const frame = data as { evt?: string; cmd?: string }
    if (frame.evt === 'READY') {
      client.ready = true
      if (enabled) send(client, OP_FRAME, setActivityFrame())
    }
  })
  client.socket.on('error', () => {
    dropClient(client.path)
    scheduleRetry()
  })
  client.socket.on('close', () => {
    if (!clients.has(client.path)) return
    dropClient(client.path)
    scheduleRetry()
  })
}

function attempt(path: string): void {
  if (!enabled || clients.has(path) || pending.has(path)) return
  pending.add(path)
  const socket = createConnection(path)
  const fail = () => {
    pending.delete(path)
    socket.destroy()
    if (enabled && clients.size === 0 && pending.size === 0) scheduleRetry()
  }
  socket.once('error', fail)
  socket.once('connect', () => {
    socket.removeListener('error', fail)
    pending.delete(path)
    if (!enabled) {
      socket.destroy()
      return
    }
    const client: Client = { path, socket, ready: false }
    clients.set(path, client)
    wireSocket(client)
    send(client, OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID })
  })
}

function connect(): void {
  if (!enabled) return
  for (const path of ipcPaths()) attempt(path)
  if (clients.size === 0 && pending.size === 0) scheduleRetry()
}

function clearRetry(): void {
  if (!retryTimer) return
  clearTimeout(retryTimer)
  retryTimer = null
}

export function setDiscordEnabled(on: boolean): void {
  if (on === enabled) {
    if (on) connect()
    return
  }
  enabled = on
  if (!on) {
    clearRetry()
    for (const client of clients.values()) {
      if (!client.ready) continue
      send(client, OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        nonce: randomUUID(),
        args: { pid: process.pid }
      })
    }
    dropAll()
    return
  }
  connect()
}

export function setDiscordActivity(activity: DiscordActivity): void {
  const lab = typeof activity?.lab === 'string' && activity.lab ? activity.lab : null
  const idle = Boolean(activity?.idle)
  if (lab !== lastLab) {
    lastLab = lab
    labEnteredAt = lab ? Date.now() : 0
  }
  last = { lab, idle }
  apply()
}

export function stopDiscordPresence(): void {
  enabled = false
  clearRetry()
  dropAll()
}

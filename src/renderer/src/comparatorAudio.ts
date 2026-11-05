import { setLabAudioCapture } from './labAudioCapture'

export type MixFocus = 'left' | 'right' | 'center'

function makeImpulse(ctx: AudioContext, seconds = 2.6, decay = 2.2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    const offset = channel === 1 ? Math.floor(ctx.sampleRate * 0.014) : 0
    for (let i = 0; i < length; i++) {
      const t = Math.max(0, i - offset) / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return buffer
}

/**
 * Mixes two clips through a wet plate reverb. Hovering a pane leans the mix that way.
 */
export class ComparatorMix {
  private readonly ctx = new AudioContext()
  private readonly master = this.ctx.createGain()
  private readonly leftGain = this.ctx.createGain()
  private readonly rightGain = this.ctx.createGain()
  private readonly dry = this.ctx.createGain()
  private readonly wet = this.ctx.createGain()
  private readonly captureDest = this.ctx.createMediaStreamDestination()
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  private closed = false

  constructor() {
    const convolver = this.ctx.createConvolver()
    convolver.buffer = makeImpulse(this.ctx)
    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 6400
    const wetShelf = this.ctx.createBiquadFilter()
    wetShelf.type = 'highshelf'
    wetShelf.frequency.value = 2800
    wetShelf.gain.value = -4

    this.dry.gain.value = 0.4
    this.wet.gain.value = 0.92
    this.leftGain.gain.value = 0.5
    this.rightGain.gain.value = 0.5
    this.master.gain.value = 0.64

    this.leftGain.connect(this.dry)
    this.leftGain.connect(this.wet)
    this.rightGain.connect(this.dry)
    this.rightGain.connect(this.wet)
    this.dry.connect(this.master)
    this.wet.connect(convolver).connect(lowpass).connect(wetShelf).connect(this.master)
    this.master.connect(this.ctx.destination)
    this.master.connect(this.captureDest)
    setLabAudioCapture(() => (this.closed ? null : this.captureDest.stream))
  }

  attach(side: 'left' | 'right', element: HTMLMediaElement): void {
    if (this.closed || this.ctx.state === 'closed' || this.sources.has(element)) return
    element.muted = false
    element.volume = 1
    element.crossOrigin = 'anonymous'
    const source = this.ctx.createMediaElementSource(element)
    this.sources.set(element, source)
    source.connect(side === 'left' ? this.leftGain : this.rightGain)
    element.addEventListener('play', () => this.resume())
    this.resume()
  }

  resume(): void {
    if (this.closed || this.ctx.state === 'closed') return
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setFocus(focus: MixFocus): void {
    if (this.closed) return
    const now = this.ctx.currentTime
    const left = focus === 'left' ? 0.94 : focus === 'right' ? 0.14 : 0.5
    const right = focus === 'right' ? 0.94 : focus === 'left' ? 0.14 : 0.5
    this.leftGain.gain.setTargetAtTime(left, now, 0.07)
    this.rightGain.gain.setTargetAtTime(right, now, 0.07)
  }

  setVolume(volume: number): void {
    if (this.closed) return
    this.master.gain.setTargetAtTime(Math.max(0, volume * volume), this.ctx.currentTime, 0.05)
  }

  close(): void {
    this.closed = true
    setLabAudioCapture(null)
    void this.ctx.close()
  }
}

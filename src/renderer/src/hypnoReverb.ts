/** Wet reverb for Hypno Station. One graph, many video elements. */

function makeImpulse(ctx: AudioContext, seconds = 2.4, decay = 2.4): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    const offset = channel === 1 ? Math.floor(ctx.sampleRate * 0.012) : 0
    for (let i = 0; i < length; i++) {
      const t = Math.max(0, i - offset) / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return buffer
}

export class HypnoReverb {
  private readonly ctx = new AudioContext()
  private readonly master = this.ctx.createGain()
  private readonly dry = this.ctx.createGain()
  private readonly wet = this.ctx.createGain()
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

  constructor() {
    const convolver = this.ctx.createConvolver()
    convolver.buffer = makeImpulse(this.ctx)
    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 7200
    this.dry.gain.value = 0.38
    this.wet.gain.value = 0.95
    this.dry.connect(this.master)
    this.wet.connect(convolver).connect(lowpass).connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  attach(element: HTMLMediaElement): void {
    if (this.ctx.state === 'closed' || this.sources.has(element)) return
    const source = this.ctx.createMediaElementSource(element)
    this.sources.set(element, source)
    source.connect(this.dry)
    source.connect(this.wet)
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.05)
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  close(): void {
    void this.ctx.close()
  }
}

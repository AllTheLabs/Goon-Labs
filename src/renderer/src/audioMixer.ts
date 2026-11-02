interface Channel {
  source: MediaElementAudioSourceNode
  gain: GainNode
}

/** How quickly channel levels glide to their targets, in seconds (avoids clicks). */
const RAMP = 0.25
/** Level of non-focused tiles while one tile is hovered. */
const DUCKED = 0.12

/**
 * Mixes the audio of many simultaneously playing videos. Each channel is scaled by
 * 1/sqrt(n) so the summed loudness stays roughly constant as tiles come and go, and a
 * compressor catches any remaining peaks before they clip.
 */
export class AudioMixer {
  private readonly ctx = new AudioContext()
  private readonly master = this.ctx.createGain()
  private readonly channels = new Map<number, Channel>()
  // An element can only ever be wrapped by one MediaElementAudioSourceNode.
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  private focused: number | null = null

  constructor(volume: number) {
    const compressor = this.ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 12
    compressor.ratio.value = 4
    compressor.attack.value = 0.01
    compressor.release.value = 0.25
    this.master.connect(compressor).connect(this.ctx.destination)
    this.setVolume(volume)
  }

  attach(key: number, element: HTMLMediaElement): void {
    if (this.ctx.state === 'closed') return
    let source = this.sources.get(element)
    if (!source) {
      source = this.ctx.createMediaElementSource(element)
      this.sources.set(element, source)
    }
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    source.connect(gain).connect(this.master)
    this.channels.set(key, { source, gain })
    this.rebalance()
  }

  detach(key: number): void {
    const channel = this.channels.get(key)
    if (!channel) return
    channel.source.disconnect()
    channel.gain.disconnect()
    this.channels.delete(key)
    if (this.focused === key) this.focused = null
    this.rebalance()
  }

  setFocus(key: number | null): void {
    this.focused = key
    this.rebalance()
  }

  /** `volume` is 0–1 on a perceptual scale. */
  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.05)
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  close(): void {
    void this.ctx.close()
  }

  private rebalance(): void {
    if (this.ctx.state === 'closed') return
    const base = 1 / Math.sqrt(Math.max(1, this.channels.size))
    const now = this.ctx.currentTime
    for (const [key, { gain }] of this.channels) {
      const target = this.focused === null ? base : key === this.focused ? 0.9 : base * DUCKED
      gain.gain.setTargetAtTime(target, now, RAMP / 3)
    }
  }
}

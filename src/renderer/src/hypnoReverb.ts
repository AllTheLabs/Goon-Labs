/** Wet reverb for clip audio, plus a dry rumble bed with a dark trance melody. */

const BPM = 72
const STEP = 60 / BPM
const LOOKAHEAD = 0.2

/** Slow E-minor bass. One note every two beats, around C1–G1. */
const BASSLINE = [41.2, 41.2, 49.0, 36.71, 41.2, 43.65, 49.0, 32.7]

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

function makeRumbleNoise(ctx: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let last = 0
    for (let i = 0; i < length; i++) {
      last += Math.random() * 2 - 1
      last *= 0.985
      data[i] = Math.max(-1, Math.min(1, last * 0.35))
    }
  }
  return buffer
}

export class HypnoReverb {
  private readonly ctx = new AudioContext()
  private readonly master = this.ctx.createGain()
  private readonly dry = this.ctx.createGain()
  private readonly wet = this.ctx.createGain()
  private readonly rumbleBus = this.ctx.createGain()
  private readonly rumbleMute = this.ctx.createGain()
  private readonly rumbleVol = this.ctx.createGain()
  private readonly droneDuck = this.ctx.createGain()
  private readonly melodyIn = this.ctx.createGain()
  private readonly melodyDuck = this.ctx.createGain()
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  private readonly drones: AudioScheduledSourceNode[] = []
  private rumbleOn = true
  private paused = false
  private closed = false
  private step = 0
  private nextStep = 0
  private clock = 0

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

    const rumbleComp = this.ctx.createDynamicsCompressor()
    rumbleComp.threshold.value = -16
    rumbleComp.knee.value = 10
    rumbleComp.ratio.value = 3.5
    rumbleComp.attack.value = 0.004
    rumbleComp.release.value = 0.14
    this.rumbleBus.connect(rumbleComp).connect(this.rumbleMute).connect(this.rumbleVol).connect(this.ctx.destination)
    this.rumbleVol.gain.value = 0.72
    this.droneDuck.gain.value = 1
    this.melodyDuck.gain.value = 1
    this.startDrone()
    this.startMelody()
    this.startClock()
  }

  attach(element: HTMLMediaElement): void {
    if (this.ctx.state === 'closed' || this.sources.has(element)) return
    const source = this.ctx.createMediaElementSource(element)
    this.sources.set(element, source)
    source.connect(this.dry)
    source.connect(this.wet)
  }

  setVolume(volume: number): void {
    const now = this.ctx.currentTime
    this.master.gain.setTargetAtTime(volume * volume, now, 0.05)
    this.rumbleVol.gain.setTargetAtTime(volume * volume * 0.72, now, 0.05)
  }

  setRumble(on: boolean): void {
    this.rumbleOn = on
    this.applyRumbleMute()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.applyRumbleMute()
  }

  /** Bass kick on each visual cut. Melody keeps its own slow grid. */
  hit(spanSeconds: number): void {
    if (!this.rumbleOn || this.paused || this.ctx.state === 'closed') return
    const t = this.ctx.currentTime
    const decay = Math.min(0.92, Math.max(0.28, spanSeconds * 0.85))
    this.thump(t, decay)
    this.burst(t, Math.min(0.34, decay))
    this.duck(this.droneDuck.gain, 1, t)
    this.duck(this.melodyDuck.gain, 1, t)
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  close(): void {
    this.closed = true
    window.clearInterval(this.clock)
    for (const node of this.drones) {
      try {
        node.stop()
      } catch {
        /* already stopped */
      }
    }
    void this.ctx.close()
  }

  private applyRumbleMute(): void {
    const open = this.rumbleOn && !this.paused ? 1 : 0
    this.rumbleMute.gain.setTargetAtTime(open, this.ctx.currentTime, 0.05)
  }

  private startDrone(): void {
    const droneGain = this.ctx.createGain()
    droneGain.gain.value = 0.11
    droneGain.connect(this.droneDuck).connect(this.rumbleBus)

    const lfo = this.ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.09
    const lfoGain = this.ctx.createGain()
    lfoGain.gain.value = 0.05
    lfo.connect(lfoGain).connect(droneGain.gain)
    lfo.start()
    this.drones.push(lfo)

    this.startOsc('sine', 41.2, -0.35, 0.7, droneGain)
    this.startOsc('sine', 61.85, 0.4, 0.55, droneGain)
    this.startOsc('triangle', 82.41, 0, 0.22, droneGain)

    const noise = this.ctx.createBufferSource()
    noise.buffer = makeRumbleNoise(this.ctx)
    noise.loop = true
    const noiseFilter = this.ctx.createBiquadFilter()
    noiseFilter.type = 'lowpass'
    noiseFilter.frequency.value = 90
    const noiseGain = this.ctx.createGain()
    noiseGain.gain.value = 0.16
    noise.connect(noiseFilter).connect(noiseGain).connect(this.droneDuck)
    noise.start()
    this.drones.push(noise)
  }

  private startMelody(): void {
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 340
    filter.Q.value = 1.6

    const lfo = this.ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.05
    const lfoGain = this.ctx.createGain()
    lfoGain.gain.value = 90
    lfo.connect(lfoGain).connect(filter.frequency)
    lfo.start()
    this.drones.push(lfo)

    const delay = this.ctx.createDelay()
    delay.delayTime.value = STEP
    const feedback = this.ctx.createGain()
    feedback.gain.value = 0.26
    const delayFilter = this.ctx.createBiquadFilter()
    delayFilter.type = 'lowpass'
    delayFilter.frequency.value = 420
    const delayOut = this.ctx.createGain()
    delayOut.gain.value = 0.28
    const dry = this.ctx.createGain()
    dry.gain.value = 1

    this.melodyIn.connect(filter).connect(this.melodyDuck)
    this.melodyDuck.connect(dry).connect(this.rumbleBus)
    this.melodyDuck.connect(delay)
    delay.connect(delayFilter).connect(feedback).connect(delay)
    delay.connect(delayOut).connect(this.rumbleBus)
  }

  private startClock(): void {
    this.nextStep = this.ctx.currentTime + 0.08
    this.clock = window.setInterval(() => this.tick(), 50)
  }

  private tick(): void {
    if (this.closed || this.ctx.state === 'closed') return
    const horizon = this.ctx.currentTime + LOOKAHEAD
    while (this.nextStep < horizon) {
      if (this.rumbleOn && !this.paused && this.nextStep >= this.ctx.currentTime - 0.02) {
        this.playStep(this.step, this.nextStep)
      }
      this.step++
      this.nextStep += STEP
    }
  }

  private playStep(step: number, t: number): void {
    if (step % 2 !== 0) return
    const freq = BASSLINE[(step / 2) % BASSLINE.length]
    const accent = step % 16 === 0 ? 1 : 0.82
    this.synthBass(t, freq, accent)
  }

  private synthBass(t: number, freq: number, accent: number): void {
    const hold = STEP * 2.15
    const saw = this.ctx.createOscillator()
    saw.type = 'sawtooth'
    saw.frequency.setValueAtTime(freq, t)
    const square = this.ctx.createOscillator()
    square.type = 'square'
    square.frequency.setValueAtTime(freq * 1.003, t)
    const sub = this.ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(freq / 2, t)

    const sawGain = this.ctx.createGain()
    const squareGain = this.ctx.createGain()
    const subGain = this.ctx.createGain()
    this.env(sawGain.gain, t, 0.22 * accent, hold, 0.1)
    this.env(squareGain.gain, t, 0.1 * accent, hold, 0.12)
    this.env(subGain.gain, t, 0.28 * accent, hold, 0.08)

    saw.connect(sawGain).connect(this.melodyIn)
    square.connect(squareGain).connect(this.melodyIn)
    sub.connect(subGain).connect(this.melodyIn)
    saw.start(t)
    square.start(t)
    sub.start(t)
    saw.stop(t + hold + 0.08)
    square.stop(t + hold + 0.08)
    sub.stop(t + hold + 0.08)
  }

  private env(param: AudioParam, t: number, peak: number, hold: number, attack: number): void {
    param.setValueAtTime(0.0001, t)
    param.exponentialRampToValueAtTime(peak, t + attack)
    param.exponentialRampToValueAtTime(peak * 0.7, t + attack + hold * 0.45)
    param.exponentialRampToValueAtTime(0.0001, t + hold)
  }

  private startOsc(
    type: OscillatorType,
    freq: number,
    pan: number,
    level: number,
    dest: AudioNode
  ): void {
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const gain = this.ctx.createGain()
    gain.gain.value = level
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = pan
    osc.connect(gain).connect(panner).connect(dest)
    osc.start()
    this.drones.push(osc)
  }

  private duck(param: AudioParam, rest: number, t: number): void {
    param.cancelScheduledValues(t)
    param.setTargetAtTime(rest * 0.22, t, 0.01)
    param.setTargetAtTime(rest, t + 0.18, 0.09)
  }

  private thump(t: number, decay: number): void {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(118, t)
    osc.frequency.exponentialRampToValueAtTime(32, t + Math.min(0.42, decay))
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.72, t + 0.016)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(gain).connect(this.rumbleBus)
    osc.start(t)
    osc.stop(t + decay + 0.04)
  }

  private burst(t: number, decay: number): void {
    const noise = this.ctx.createBufferSource()
    noise.buffer = makeRumbleNoise(this.ctx, 0.5)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(140, t)
    filter.frequency.exponentialRampToValueAtTime(55, t + decay)
    filter.Q.value = 1.2
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    noise.connect(filter).connect(gain).connect(this.rumbleBus)
    noise.start(t)
    noise.stop(t + decay + 0.04)
  }
}

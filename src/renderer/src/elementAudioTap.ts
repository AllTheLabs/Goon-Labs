import { setLabAudioCapture } from './labAudioCapture'

/** Routes a single video element through Web Audio so session recordings hear the same mix. */
export class ElementAudioTap {
  private readonly ctx = new AudioContext()
  private readonly captureDest = this.ctx.createMediaStreamDestination()
  private source: MediaElementAudioSourceNode | null = null
  private attached: HTMLMediaElement | null = null
  private closed = false

  attach(element: HTMLMediaElement): void {
    if (this.closed || this.attached === element) return
    this.source?.disconnect()
    this.source = this.ctx.createMediaElementSource(element)
    this.source.connect(this.ctx.destination)
    this.source.connect(this.captureDest)
    this.attached = element
    setLabAudioCapture(() => (this.closed ? null : this.captureDest.stream))
    const resume = () => void this.ctx.resume()
    element.addEventListener('play', resume)
    void this.ctx.resume()
  }

  close(): void {
    this.closed = true
    this.source?.disconnect()
    this.source = null
    this.attached = null
    setLabAudioCapture(null)
    void this.ctx.close()
  }
}

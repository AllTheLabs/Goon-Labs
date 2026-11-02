import { useEffect, useRef, useState } from 'react'
import { HeartPulse, LoaderPinwheel, Palette, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface EffectSettings {
  spiral: boolean
  heart: boolean
  particles: boolean
  tint: boolean
  /** 0–1, applies to every effect. */
  opacity: number
  /** Spiral line width as a fraction of the gap between lines. */
  spiralThickness: number
}

const STORAGE_KEY = 'scroller.effects'
const DEFAULT_SETTINGS: EffectSettings = {
  spiral: false,
  heart: false,
  particles: false,
  tint: false,
  opacity: 0.6,
  spiralThickness: 0.16
}

/** Effect settings, remembered between sessions. */
export function useEffectSettings() {
  const [settings, setSettings] = useState<EffectSettings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
    } catch {
      return DEFAULT_SETTINGS
    }
  })
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), [settings])
  return [settings, setSettings] as const
}

export function anyEffectActive(s: EffectSettings): boolean {
  return s.spiral || s.heart || s.particles || s.tint
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

const VERTEX_SHADER = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

/** Spiral and heart, output as premultiplied alpha so the videos show through. */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_spiral;
uniform float u_heart;
uniform float u_thickness;
out vec4 outColor;

const float TAU = 6.2831853;
const vec3 HOT_PINK = vec3(1.0, 0.18, 0.58);
const vec3 MAGENTA = vec3(0.86, 0.22, 1.0);

float dot2(vec2 v) { return dot(v, v); }

// Exact heart distance (Inigo Quilez). Tip at the origin, lobes around y = 1.
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }

// Thin lines along an Archimedean spiral. Returns (line coverage, soft glow).
// The anti-aliasing width comes from the analytic gradient of the phase, because
// fwidth() would spike along atan's -pi/pi seam and draw a visible crease.
vec2 spiralLines(vec2 uv, float r, float rWarped, float a, float arms, float tightness, float spin, float thickness, float pixel) {
  float phase = arms * a + tightness * rWarped - spin;
  vec2 gradient = arms * vec2(-uv.y, uv.x) / (r * r) + tightness * uv / r;
  float aa = length(gradient) * pixel / TAU;
  float d = abs(fract(phase / TAU) - 0.5);
  float halfWidth = thickness * 0.5;
  float line = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d);
  float glow = exp(-max(d - halfWidth, 0.0) * 16.0);
  return vec2(line, glow);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  vec4 color = vec4(0.0);

  if (u_spiral > 0.5) {
    float t = u_time;
    float r = max(length(uv), 1e-4);
    float a = atan(uv.y, uv.x);
    float pixel = 1.0 / min(u_res.x, u_res.y);
    // A slight liquid wobble so the lines never feel mechanical. It scales with the radius,
    // or the small inner rings would be bent into polygons.
    float wobble = min(1.0, r * 3.0);
    float rWarped = r + wobble * (0.006 * sin(a * 5.0 + t * 1.3) + 0.004 * sin(r * 30.0 - t * 2.0));
    // The spin "breathes": the inward pull swells and eases every ~14 seconds.
    float spin = t * 3.2 + 2.4 * sin(t * 0.45);

    vec2 primary = spiralLines(uv, r, rWarped, a, 2.0, 64.0, spin, u_thickness, pixel);
    // A faint counter-rotating spiral; where the two cross, a shimmering moire appears.
    vec2 counter = spiralLines(uv, r, rWarped, a, -3.0, 57.0, -t * 1.7, u_thickness * 0.7, pixel);

    // Lines converge to sub-pixel width at the centre, so hand off to the glowing core there.
    float centreFade = smoothstep(0.02, 0.1, r);
    // Bright bands that travel inward along the lines.
    float pulse = pow(0.5 + 0.5 * sin(r * 9.0 + t * 2.4), 6.0);
    vec3 hue = mix(HOT_PINK, MAGENTA, 0.5 + 0.5 * sin(r * 14.0 - t * 2.2));

    float vignette = smoothstep(0.35, 0.95, r) * 0.35;
    color = vec4(0.0, 0.0, 0.0, vignette);

    float glowAlpha = primary.y * centreFade * (0.18 + 0.3 * pulse);
    color = over(vec4(hue * glowAlpha, glowAlpha), color);

    float counterAlpha = counter.x * centreFade * 0.22;
    color = over(vec4(MAGENTA * counterAlpha, counterAlpha), color);

    float lineAlpha = primary.x * centreFade;
    vec3 lineColor = min(mix(hue, vec3(1.0, 0.86, 0.95), 0.45 * pulse) * (1.0 + 0.4 * pulse), vec3(1.0));
    color = over(vec4(lineColor * lineAlpha, lineAlpha), color);

    float breathe = 0.5 + 0.5 * sin(t * 0.9);
    float core = exp(-r * (24.0 - 9.0 * breathe));
    color = over(vec4(vec3(1.0, 0.9, 0.97) * core, core), color);
  }

  if (u_heart > 0.5) {
    // "Lub-dub" heartbeat at ~70 bpm.
    float beat = fract(u_time * 1.15);
    float pulse = 1.0 + 0.11 * exp(-beat * 9.0) + 0.07 * exp(-max(beat - 0.22, 0.0) * 9.0) * step(0.22, beat);
    vec2 p = uv * 2.0 / (0.95 * pulse);
    p.y += 0.52;
    float d = sdHeart(p);
    float w = fwidth(d);
    float fill = 1.0 - smoothstep(-w, w, d);
    vec3 body = mix(vec3(0.92, 0.05, 0.38), vec3(1.0, 0.48, 0.74), clamp(p.y, 0.0, 1.0));
    // Glossy highlight on the upper-left lobe.
    body += 0.35 * exp(-dot2(p - vec2(-0.32, 0.78)) * 30.0);
    float glow = exp(-max(d, 0.0) * 5.0) * (0.35 + 1.6 * (pulse - 1.0));
    color = over(vec4(HOT_PINK * glow, glow) * (1.0 - fill), color);
    color = over(vec4(body * fill, fill), color);
  }

  outColor = color;
}`

function createShaderProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
    return null
  }
  return program
}

function traceHeart(ctx: CanvasRenderingContext2D, size: number) {
  // Unit heart spanning x -0.5..0.5 and y 0..1, then centred.
  const s = size
  ctx.beginPath()
  ctx.moveTo(0, -0.2 * s)
  ctx.bezierCurveTo(0, -0.5 * s, -0.5 * s, -0.5 * s, -0.5 * s, -0.2 * s)
  ctx.bezierCurveTo(-0.5 * s, 0.1 * s, 0, 0.25 * s, 0, 0.5 * s)
  ctx.bezierCurveTo(0, 0.25 * s, 0.5 * s, 0.1 * s, 0.5 * s, -0.2 * s)
  ctx.bezierCurveTo(0.5 * s, -0.5 * s, 0, -0.5 * s, 0, -0.2 * s)
  ctx.closePath()
}

const SPRITE_SIZE = 96
const SPRITE_COLORS: [string, string][] = [
  ['#ff9ccc', '#ff1f87'],
  ['#ff7ab8', '#d10a63'],
  ['#ffc2e0', '#ff4fa3']
]

/** Pre-rendered glowing heart sprites, so each particle is a single cheap drawImage. */
function createHeartSprites(): HTMLCanvasElement[] {
  return SPRITE_COLORS.map(([light, dark]) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SPRITE_SIZE
    const ctx = canvas.getContext('2d')!
    ctx.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2)
    const size = SPRITE_SIZE * 0.62
    const gradient = ctx.createRadialGradient(-size * 0.15, -size * 0.2, 1, 0, 0, size * 0.7)
    gradient.addColorStop(0, light)
    gradient.addColorStop(1, dark)
    ctx.shadowColor = dark
    ctx.shadowBlur = SPRITE_SIZE * 0.12
    ctx.fillStyle = gradient
    traceHeart(ctx, size)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = SPRITE_SIZE * 0.035
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.stroke()
    return canvas
  })
}

interface Particle {
  x: number
  y: number
  size: number
  rise: number
  sway: number
  swaySpeed: number
  phase: number
  spin: number
  sprite: number
  age: number
  lifetime: number
}

function spawnParticle(width: number, height: number, anywhere: boolean): Particle {
  const lifetime = 6 + Math.random() * 8
  return {
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 40,
    size: 26 + Math.random() ** 1.5 * 64,
    rise: 25 + Math.random() * 70,
    sway: 15 + Math.random() * 40,
    swaySpeed: 0.4 + Math.random() * 1.2,
    phase: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.6,
    sprite: Math.floor(Math.random() * SPRITE_COLORS.length),
    age: anywhere ? Math.random() * lifetime : 0,
    lifetime
  }
}

/** Renders the enabled effects over the whole scroller. Never intercepts the mouse. */
export function EffectsOverlay({ settings }: { settings: EffectSettings }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<HTMLCanvasElement>(null)
  const live = useRef(settings)
  live.current = settings

  const shaderOn = settings.spiral || settings.heart

  useEffect(() => {
    const root = rootRef.current
    const glCanvas = glRef.current
    const particleCanvas = particlesRef.current
    if (!root || !glCanvas || !particleCanvas) return

    const gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
    const program = gl ? createShaderProgram(gl) : null
    let uniforms: Record<string, WebGLUniformLocation | null> = {}
    if (gl && program) {
      gl.useProgram(program)
      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      uniforms = Object.fromEntries(
        ['u_res', 'u_time', 'u_spiral', 'u_heart', 'u_thickness'].map((name) => [
          name,
          gl.getUniformLocation(program, name)
        ])
      )
    }

    const ctx = particleCanvas.getContext('2d')!
    const sprites = createHeartSprites()
    let particles: Particle[] = []
    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      const rect = root.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = window.devicePixelRatio || 1
      for (const canvas of [glCanvas, particleCanvas]) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      const count = Math.round(Math.min(70, Math.max(16, (width * height) / 36000)))
      particles = Array.from({ length: count }, () => spawnParticle(width, height, true))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(root)

    let frame = 0
    let last = performance.now()
    const start = last
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = live.current

      if (gl && program && (s.spiral || s.heart)) {
        gl.viewport(0, 0, glCanvas.width, glCanvas.height)
        gl.uniform2f(uniforms.u_res, glCanvas.width, glCanvas.height)
        gl.uniform1f(uniforms.u_time, (now - start) / 1000)
        gl.uniform1f(uniforms.u_spiral, s.spiral ? 1 : 0)
        gl.uniform1f(uniforms.u_heart, s.heart ? 1 : 0)
        gl.uniform1f(uniforms.u_thickness, s.spiralThickness)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }

      if (s.particles) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height)
        const t = (now - start) / 1000
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]
          p.age += dt
          p.y -= p.rise * dt
          if (p.age > p.lifetime || p.y < -60) {
            particles[i] = spawnParticle(width, height, false)
            continue
          }
          const x = p.x + Math.sin(t * p.swaySpeed + p.phase) * p.sway
          const fade = Math.min(1, p.age / 1.2, (p.lifetime - p.age) / 1.5)
          const beat = 1 + 0.08 * Math.sin(t * 6 + p.phase)
          const size = p.size * beat * dpr
          ctx.globalAlpha = Math.max(0, fade)
          ctx.setTransform(1, 0, 0, 1, x * dpr, p.y * dpr)
          ctx.rotate(Math.sin(t * p.spin * 3 + p.phase) * 0.35)
          ctx.drawImage(sprites[p.sprite], -size / 2, -size / 2, size, size)
        }
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return (
    <div className="effects-root" ref={rootRef}>
      {/* Blend modes must sit outside the opacity group, or they'd blend against nothing. */}
      <div
        className="effects-tint"
        style={{ opacity: settings.tint ? settings.opacity * 0.85 : 0 }}
      />
      <div className="effects-layers" style={{ opacity: settings.opacity }}>
        <canvas ref={glRef} className="effects-canvas" style={{ visibility: shaderOn ? 'visible' : 'hidden' }} />
        <canvas
          ref={particlesRef}
          className="effects-canvas"
          style={{ visibility: settings.particles ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

const EFFECTS: { key: 'spiral' | 'heart' | 'particles' | 'tint'; label: string; icon: LucideIcon }[] = [
  { key: 'spiral', label: 'Pink spiral', icon: LoaderPinwheel },
  { key: 'heart', label: 'Pulsing heart', icon: HeartPulse },
  { key: 'particles', label: 'Heart particles', icon: Sparkles },
  { key: 'tint', label: 'Pink filter', icon: Palette }
]

interface EffectsPanelProps {
  settings: EffectSettings
  onChange: (update: (current: EffectSettings) => EffectSettings) => void
}

export function EffectsPanel({ settings, onChange }: EffectsPanelProps) {
  const toggle = (key: (typeof EFFECTS)[number]['key']) =>
    onChange((current) => {
      const enabling = !current[key]
      const next = { ...current, [key]: enabling }
      // The spiral and heart are designed to sit on a pink-filtered scroller.
      if (enabling && (key === 'spiral' || key === 'heart')) next.tint = true
      return next
    })

  return (
    <div className="effects-panel" onClick={(e) => e.stopPropagation()}>
      <div className="effects-panel-title">Overlay effects</div>
      <div className="effects-grid">
        {EFFECTS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`effect-toggle ${settings[key] ? 'active' : ''}`}
            onClick={() => toggle(key)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <label className="effects-opacity">
        <span>Opacity</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={settings.opacity}
          onChange={(e) => {
            const opacity = Number(e.target.value)
            onChange((current) => ({ ...current, opacity }))
          }}
        />
        <span className="scroller-value">{Math.round(settings.opacity * 100)}%</span>
      </label>
      {settings.spiral && (
        <label className="effects-opacity">
          <span>Thickness</span>
          <input
            type="range"
            min={0.04}
            max={0.5}
            step={0.01}
            value={settings.spiralThickness}
            onChange={(e) => {
              const spiralThickness = Number(e.target.value)
              onChange((current) => ({ ...current, spiralThickness }))
            }}
          />
          <span className="scroller-value">{Math.round(settings.spiralThickness * 100)}%</span>
        </label>
      )}
    </div>
  )
}

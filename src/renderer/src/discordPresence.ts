import { useEffect, useRef, useState } from 'react'

const IDLE_MS = 5 * 60 * 1000

/** Pushes browsing / idle / lab presence to Discord while the setting is on. */
export function useDiscordPresence(lab: string | null): void {
  const [idle, setIdle] = useState(false)
  const idleRef = useRef(false)

  useEffect(() => {
    let timer = 0
    const bump = () => {
      if (idleRef.current) {
        idleRef.current = false
        setIdle(false)
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        idleRef.current = true
        setIdle(true)
      }, IDLE_MS)
    }
    bump()
    const opts: AddEventListenerOptions = { capture: true }
    window.addEventListener('pointerdown', bump, opts)
    window.addEventListener('pointermove', bump, opts)
    window.addEventListener('keydown', bump, opts)
    window.addEventListener('wheel', bump, opts)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', bump, opts)
      window.removeEventListener('pointermove', bump, opts)
      window.removeEventListener('keydown', bump, opts)
      window.removeEventListener('wheel', bump, opts)
    }
  }, [])

  useEffect(() => {
    void window.api.setDiscordActivity({ lab, idle: lab ? false : idle })
  }, [lab, idle])
}

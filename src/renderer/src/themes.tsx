import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  Clapperboard,
  Clock,
  Disc3,
  Droplet,
  Hash,
  Heart,
  HeartPulse,
  Grid3x3,
  Image,
  ListVideo,
  Orbit,
  Scissors,
  Spade,
  Sparkles,
  Tornado,
  Transgender
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

type Icon = ComponentType<LucideProps>

/** A playing card showing the ace of spades, drawn to match lucide's stroke style. */
export function AceOfSpades({ size = 24, strokeWidth = 2, className, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(rest as object)}
    >
      <rect x="4" y="2" width="16" height="20" rx="2.5" />
      <path
        d="M12 7.5c-1.6 2-3.6 3.1-3.6 5a1.9 1.9 0 0 0 3.2 1.4L11 16.5h2l-.6-2.6a1.9 1.9 0 0 0 3.2-1.4c0-1.9-2-3-3.6-5z"
        fill="currentColor"
        strokeWidth={1}
      />
      <path d="M6.6 6.2 7.5 4l.9 2.2M6.9 5.5h1.2" strokeWidth={1.2} />
    </svg>
  )
}

function SolidDroplet(props: LucideProps) {
  return <Droplet fill="currentColor" {...props} />
}

function SolidSpade(props: LucideProps) {
  return <Spade fill="currentColor" {...props} />
}

function HypnoSpiral({ size = 24, strokeWidth = 2, className, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      {...(rest as object)}
    >
      <path d="M12 12c.8-.8 2.1-.6 2.6.4.7 1.5-.4 3.2-2 3.6-2.3.6-4.3-1.1-4.5-3.3-.3-3 2.3-5.5 5.3-5.4 3.7.1 6.6 3.3 6.4 7-.3 4.5-4.2 8-8.7 7.8" />
    </svg>
  )
}

export interface ThemeCopy {
  appName: string
  libraryHeading: string
  allMedia: string
  photos: string
  videos: string
  untagged: string
  untaggedEmptyTitle: string
  untaggedEmptyBody: string
  untaggedHint: string
  labsHeading: string
  scroller: string
  queue: string
  pixelPerfection: string
  utilitiesHeading: string
  trimmer: string
  timeDilation: string
  goonImageFormat: string
  tagsHeading: string
  tagsEmpty: string
  searchPlaceholder: string
  emptyTitle: string
  emptyBody: string
  welcomeTitle: string
  liveCaption: string
}

export interface ThemeIcons {
  brand: Icon
  tag: Icon
  scroller: Icon
  queue: Icon
  pixelPerfection: Icon
  trimmer: Icon
  timeDilation: Icon
  goonImageFormat: Icon
  live?: Icon
}

/** How Beat Bar markers are drawn. */
export type BeatShape = 'circle' | 'disk' | 'spade' | 'heart'

export interface Theme {
  id: string
  name: string
  description: string
  group: 'standard' | 'extra'
  scheme: 'dark' | 'light'
  /** CSS custom properties, without the leading `--`. */
  vars: Record<string, string>
  copy?: Partial<ThemeCopy>
  icons?: Partial<ThemeIcons>
  beatShape?: BeatShape
}

const DEFAULT_COPY: ThemeCopy = {
  appName: 'Goon Labs',
  libraryHeading: 'Library',
  allMedia: 'All media',
  photos: 'Photos',
  videos: 'Videos',
  untagged: 'Untagged',
  untaggedEmptyTitle: 'Nothing left to tag',
  untaggedEmptyBody: 'Every photo and video already has at least one tag.',
  untaggedHint:
    'This item stays in the list until you click another one, so you can add more than one tag.',
  labsHeading: 'Labs',
  scroller: 'Scroller',
  queue: 'Beat Bar',
  pixelPerfection: 'Pixel Perfection',
  utilitiesHeading: 'Utilities',
  trimmer: 'Trimmer',
  timeDilation: 'Time Dilation',
  goonImageFormat: 'Goon Image Format',
  tagsHeading: 'Tags',
  tagsEmpty: 'Tags you add to media will show up here.',
  searchPlaceholder: 'Search names & tags…',
  emptyTitle: 'Your library is empty',
  emptyBody: 'Import photos and videos, or drag them anywhere onto this window.',
  welcomeTitle: 'Welcome to Goon Labs',
  liveCaption: 'live session in progress'
}

const DEFAULT_ICONS: ThemeIcons = {
  brand: SolidDroplet,
  tag: Hash,
  scroller: Clapperboard,
  queue: ListVideo,
  pixelPerfection: Grid3x3,
  trimmer: Scissors,
  timeDilation: Clock,
  goonImageFormat: Image
}

const LIGHT_BASE = {
  shadow: '0 12px 40px rgba(60, 40, 80, 0.16)',
  'card-shadow': '0 8px 24px rgba(60, 40, 80, 0.14)',
  backdrop: 'rgba(40, 30, 50, 0.35)'
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The default dark look',
    group: 'standard',
    scheme: 'dark',
    vars: {}
  },
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Clean and bright',
    group: 'standard',
    scheme: 'light',
    vars: {
      ...LIGHT_BASE,
      bg: '#f5f6fa',
      'bg-elev': '#ffffff',
      'bg-elev-2': '#eef0f5',
      'bg-hover': '#e4e7ef',
      border: '#e0e3eb',
      'border-strong': '#cdd2de',
      text: '#1b1e27',
      'text-dim': '#566074',
      'text-faint': '#8a92a5',
      accent: '#5b4cf0',
      'accent-hover': '#6d5ff5',
      'accent-soft': 'rgba(91, 76, 240, 0.12)',
      'accent-2': '#2f8fe8',
      'media-bg': '#dfe2ea',
      glass: 'rgba(255, 255, 255, 0.9)'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Cool arctic blues',
    group: 'standard',
    scheme: 'dark',
    vars: {
      bg: '#242933',
      'bg-elev': '#2e3440',
      'bg-elev-2': '#3b4252',
      'bg-hover': '#434c5e',
      border: '#3b4252',
      'border-strong': '#4c566a',
      text: '#eceff4',
      'text-dim': '#c0c8d6',
      'text-faint': '#8590a5',
      accent: '#5e81ac',
      'accent-hover': '#6f91bb',
      'accent-soft': 'rgba(136, 192, 208, 0.16)',
      'accent-2': '#88c0d0',
      success: '#a3be8c',
      danger: '#bf616a',
      info: '#81a1c1',
      'media-bg': '#1d2129'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Purple, pink and neon',
    group: 'standard',
    scheme: 'dark',
    vars: {
      bg: '#1e1f29',
      'bg-elev': '#282a36',
      'bg-elev-2': '#313442',
      'bg-hover': '#3c3f51',
      border: '#363948',
      'border-strong': '#44475a',
      text: '#f8f8f2',
      'text-dim': '#bdbfd0',
      'text-faint': '#7d82a8',
      accent: '#bd93f9',
      'accent-hover': '#caa7fb',
      'accent-soft': 'rgba(189, 147, 249, 0.16)',
      'accent-2': '#ff79c6',
      'accent-contrast': '#1e1f29',
      success: '#50fa7b',
      danger: '#ff5555',
      info: '#8be9fd',
      'media-bg': '#16171f'
    }
  },
  {
    id: 'mocha',
    name: 'Mocha',
    description: 'Soft pastel warmth',
    group: 'standard',
    scheme: 'dark',
    vars: {
      bg: '#181825',
      'bg-elev': '#1e1e2e',
      'bg-elev-2': '#262637',
      'bg-hover': '#313244',
      border: '#2c2c3e',
      'border-strong': '#45475a',
      text: '#cdd6f4',
      'text-dim': '#a6adc8',
      'text-faint': '#7f849c',
      accent: '#cba6f7',
      'accent-hover': '#d6b9fa',
      'accent-soft': 'rgba(203, 166, 247, 0.15)',
      'accent-2': '#f5c2e7',
      'accent-contrast': '#1e1e2e',
      success: '#a6e3a1',
      danger: '#f38ba8',
      info: '#89b4fa',
      'media-bg': '#11111b'
    }
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep greens and moss',
    group: 'standard',
    scheme: 'dark',
    vars: {
      bg: '#0f1512',
      'bg-elev': '#151d18',
      'bg-elev-2': '#1b2620',
      'bg-hover': '#22302a',
      border: '#223029',
      'border-strong': '#2e4037',
      text: '#e3ede6',
      'text-dim': '#9fb3a6',
      'text-faint': '#6c8275',
      accent: '#3fae74',
      'accent-hover': '#4fc285',
      'accent-soft': 'rgba(63, 174, 116, 0.16)',
      'accent-2': '#c3d86b',
      info: '#62b6c9',
      'media-bg': '#0a0f0c'
    }
  },
  {
    id: 'hypnotic',
    name: 'Hypnotic',
    description: 'Swirling violet trance',
    group: 'extra',
    scheme: 'dark',
    vars: {
      bg: '#0c0414',
      'bg-elev': 'rgba(22, 8, 36, 0.78)',
      'bg-elev-2': 'rgba(40, 14, 62, 0.85)',
      'bg-hover': 'rgba(78, 28, 112, 0.6)',
      border: 'rgba(160, 80, 220, 0.2)',
      'border-strong': 'rgba(190, 100, 255, 0.35)',
      text: '#f6e9ff',
      'text-dim': '#c4a6dc',
      'text-faint': '#8e6eaa',
      accent: '#e040fb',
      'accent-hover': '#ea6dfc',
      'accent-soft': 'rgba(224, 64, 251, 0.18)',
      'accent-2': '#7c4dff',
      info: '#b388ff',
      'media-bg': '#08020e',
      glass: 'rgba(22, 8, 36, 0.8)'
    },
    copy: {
      appName: 'Hypno Vault',
      libraryHeading: 'Relax',
      allMedia: 'Everything',
      untagged: 'No triggers yet',
      untaggedEmptyTitle: 'Every file has a trigger',
      untaggedEmptyBody: 'Nothing left untagged in the vault.',
      untaggedHint: 'Keep adding triggers. This file stays until you drift to another.',
      queue: 'Trance Beat Bar',
      scroller: 'Go deeper',
      tagsHeading: 'Triggers',
      tagsEmpty: 'Triggers you add to media will float up here.',
      searchPlaceholder: 'Let your mind search…',
      emptyTitle: 'Breathe in… your vault is empty',
      emptyBody: 'Import photos and videos, or let them sink onto this window.',
      welcomeTitle: 'Relax into Hypno Vault',
      liveCaption: 'hypno session in progress'
    },
    icons: { brand: Tornado, tag: Sparkles, scroller: Orbit, queue: Disc3, live: HypnoSpiral },
    beatShape: 'disk'
  },
  {
    id: 'blacked',
    name: 'Blacked',
    description: 'Black, white & spades',
    group: 'extra',
    scheme: 'dark',
    vars: {
      bg: '#000000',
      'bg-elev': '#070707',
      'bg-elev-2': '#111111',
      'bg-hover': '#1c1c1c',
      border: '#1f1f1f',
      'border-strong': '#3a3a3a',
      text: '#ffffff',
      'text-dim': '#b5b5b5',
      'text-faint': '#777777',
      accent: '#ffffff',
      'accent-hover': '#dcdcdc',
      'accent-soft': 'rgba(255, 255, 255, 0.1)',
      'accent-2': '#5a5a5a',
      'accent-contrast': '#000000',
      success: '#e6e6e6',
      danger: '#ffffff',
      info: '#9a9a9a',
      radius: '4px',
      'radius-lg': '6px',
      'media-bg': '#000000',
      glass: 'rgba(8, 8, 8, 0.92)'
    },
    copy: {
      appName: 'BLACKED',
      libraryHeading: 'Blacked library',
      allMedia: 'All blacked',
      photos: 'Blacked pics',
      videos: 'Blacked videos',
      untagged: 'Not blacked yet',
      untaggedEmptyTitle: 'Everything is blacked',
      untaggedEmptyBody: 'Every file already has at least one spade.',
      untaggedHint: 'Keep blacking this file. It stays until you click another one.',
      queue: 'Blacked Beat Bar',
      scroller: 'Blacked scroller',
      tagsHeading: 'Spades',
      tagsEmpty: 'Spades you tag media with will show up here.',
      searchPlaceholder: 'Search blacked media…',
      emptyTitle: 'Nothing blacked yet',
      emptyBody: 'Import photos and videos to get your library blacked.',
      welcomeTitle: 'Welcome to BLACKED',
      liveCaption: 'blacked session in progress'
    },
    icons: { brand: AceOfSpades, tag: SolidSpade, scroller: AceOfSpades, queue: SolidSpade, live: SolidSpade },
    beatShape: 'spade'
  },
  {
    id: 'sissy',
    name: 'Sissy',
    description: 'Trans flag pink, blue & white',
    group: 'extra',
    scheme: 'light',
    vars: {
      ...LIGHT_BASE,
      bg: '#fdf6f9',
      'bg-elev': '#ffffff',
      'bg-elev-2': '#fdeef4',
      'bg-hover': '#fbe0eb',
      border: '#f5d5e2',
      'border-strong': '#ecbad0',
      text: '#3b2635',
      'text-dim': '#7d5d72',
      'text-faint': '#ad8ea2',
      accent: '#ec6f9c',
      'accent-hover': '#f2689c',
      'accent-soft': 'rgba(245, 169, 184, 0.3)',
      'accent-2': '#5bcefa',
      success: '#3bb3e0',
      danger: '#e0457b',
      info: '#5bcefa',
      'media-bg': '#f7e3ec',
      glass: 'rgba(255, 255, 255, 0.92)'
    },
    copy: {
      appName: 'Sissy Vault',
      libraryHeading: 'Sissy library',
      allMedia: 'All sissy media',
      photos: 'Sissy pics',
      videos: 'Sissy videos',
      untagged: 'Untagged sissy media',
      untaggedEmptyTitle: 'All tagged, sissy',
      untaggedEmptyBody: 'Every sissy file already has at least one tag.',
      untaggedHint: 'Add as many sissy tags as you want. This stays until you click another one.',
      queue: 'Sissy Beat Bar',
      scroller: 'Sissy scroller',
      tagsHeading: 'Sissy tags',
      tagsEmpty: 'Sissy tags you add will show up here.',
      searchPlaceholder: 'Search sissy media…',
      emptyTitle: 'Your sissy library is empty',
      emptyBody: 'Import photos and videos, or drag them onto this window, sissy.',
      welcomeTitle: 'Welcome, sissy',
      liveCaption: 'sissification in progress'
    },
    icons: { brand: Transgender, tag: Heart, queue: HeartPulse, live: Transgender },
    beatShape: 'heart'
  }
]

/** Midnight's values from styles.css, used to fill gaps when previewing a theme. */
const BASE_VARS: Record<string, string> = {
  bg: '#0d0f14',
  'bg-elev': '#13161d',
  'bg-elev-2': '#1a1e27',
  border: '#252a36',
  text: '#e8eaf0',
  'text-dim': '#9aa1b2',
  accent: '#7c6cff',
  'accent-2': '#5ab0ff'
}

export function themeVar(theme: Theme, name: string): string {
  return theme.vars[name] ?? BASE_VARS[name]
}

const STORAGE_KEY = 'ui.theme'
const ALL_VARS = [...new Set(THEMES.flatMap((t) => Object.keys(t.vars)))]

function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const name of ALL_VARS) root.style.removeProperty(`--${name}`)
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(`--${name}`, value)
  root.style.colorScheme = theme.scheme
  root.dataset.theme = theme.id
  document.title = theme.copy?.appName ?? DEFAULT_COPY.appName
}

export function loadSavedTheme(): Theme {
  return themeById(localStorage.getItem(STORAGE_KEY))
}

interface ThemeContextValue {
  theme: Theme
  copy: ThemeCopy
  icons: ThemeIcons
  setTheme: (id: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(loadSavedTheme)

  useEffect(() => applyTheme(theme), [theme])

  const setTheme = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setThemeState(themeById(id))
  }, [])

  const value: ThemeContextValue = {
    theme,
    copy: { ...DEFAULT_COPY, ...theme.copy },
    icons: { ...DEFAULT_ICONS, ...theme.icons },
    setTheme
  }
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}

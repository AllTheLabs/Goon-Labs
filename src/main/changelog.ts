import { app, net } from 'electron'
import type { AppChangelog, ChangelogRelease } from '../shared/types'

const RELEASES_URL = 'https://api.github.com/repos/AllTheLabs/Goon-Labs/releases?per_page=30'
const USER_AGENT = 'Goon-Labs'

interface ChangelogConfig {
  lastChangelogVersion?: string
}

function parseVersion(raw: string): number[] {
  return raw
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export async function pendingChangelog(
  readConfig: () => Promise<ChangelogConfig>,
  writeConfig: (lastChangelogVersion: string) => Promise<void>
): Promise<AppChangelog | null> {
  const currentVersion = app.getVersion()
  const { lastChangelogVersion } = await readConfig()
  if (lastChangelogVersion && compareVersions(currentVersion, lastChangelogVersion) <= 0) {
    return null
  }

  try {
    const response = await net.fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT
      }
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      tag_name?: string
      name?: string
      body?: string | null
      html_url?: string
      draft?: boolean
      prerelease?: boolean
    }[]
    const releases: ChangelogRelease[] = payload
      .filter((release) => !release.draft && !release.prerelease && release.tag_name)
      .map((release) => ({
        version: release.tag_name!.replace(/^v/i, ''),
        title: release.name?.trim() || release.tag_name!.replace(/^v/i, ''),
        body: (release.body ?? '').trim(),
        url: release.html_url ?? ''
      }))
      .filter((release) => {
        if (compareVersions(release.version, currentVersion) > 0) return false
        if (!lastChangelogVersion) return compareVersions(release.version, currentVersion) === 0
        return compareVersions(release.version, lastChangelogVersion) > 0
      })
      .sort((a, b) => compareVersions(b.version, a.version))

    if (releases.length === 0) {
      await writeConfig(currentVersion)
      return null
    }
    return { currentVersion, fromVersion: lastChangelogVersion ?? currentVersion, releases }
  } catch {
    return null
  }
}

export async function dismissChangelog(
  writeConfig: (lastChangelogVersion: string) => Promise<void>
): Promise<void> {
  await writeConfig(app.getVersion())
}

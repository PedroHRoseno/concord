import { useEffect, useState } from 'react'
import { openLink } from '@renderer/lib/chat'
import { isCapacitor, isElectron } from '@renderer/lib/platform'

const RELEASES_URL = 'https://api.github.com/repos/PedroHRoseno/concord/releases?per_page=10'

export interface ApkRelease {
  version: string
  url: string
}

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface ReleaseResponse {
  tag_name?: string
  assets?: ReleaseAsset[]
}

let loading: Promise<ApkRelease | null> | null = null

function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.replace(/^v/, '').split('.').map((part) => parseInt(part, 10) || 0)
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function loadApkRelease(): Promise<ApkRelease | null> {
  if (!loading) {
    loading = fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' } })
      .then(async (response) => {
        if (!response.ok) return null
        const releases = (await response.json()) as ReleaseResponse[]
        for (const release of releases) {
          const asset = release.assets?.find((item) => item.name?.toLowerCase().endsWith('.apk') && item.browser_download_url)
          if (!asset?.browser_download_url) continue
          return { version: (release.tag_name ?? '').replace(/^v/, ''), url: asset.browser_download_url }
        }
        return null
      })
      .catch(() => null)
  }
  return loading
}

function useApkRelease(): ApkRelease | null {
  const [release, setRelease] = useState<ApkRelease | null>(null)
  useEffect(() => {
    let cancel = false
    void loadApkRelease().then((found) => {
      if (!cancel) setRelease(found)
    })
    return () => {
      cancel = true
    }
  }, [])
  return release
}

export function DownloadApkButton() {
  const release = useApkRelease()
  if (!isElectron() || !release) return null
  return (
    <button
      type="button"
      onClick={() => openLink(release.url)}
      className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
    >
      Baixar APK Android
    </button>
  )
}

export function AndroidUpdateNotice() {
  const release = useApkRelease()
  const current = import.meta.env.VITE_APP_VERSION ?? ''
  if (!isCapacitor() || !release || !current || compareVersions(release.version, current) <= 0) return null
  return (
    <p className="bg-blurple/15 px-4 py-2 text-sm text-ink" role="status">
      Nova versão disponível ({release.version}).
      <button type="button" onClick={() => openLink(release.url)} className="ml-2 font-semibold underline">
        Baixar
      </button>
    </p>
  )
}

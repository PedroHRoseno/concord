import { execFile } from 'node:child_process'
import { ipcMain, type WebContents } from 'electron'

interface LoopbackSession {
  stop: () => void
}

let active: LoopbackSession | null = null
let target: WebContents | null = null

function hwndFromSource(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const hwnd = Number(match[1])
  return Number.isInteger(hwnd) && hwnd > 0 ? hwnd : null
}

function pidFromHwnd(hwnd: number): Promise<number | null> {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConcordPid {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$processId = [uint32]0
[ConcordPid]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$processId) | Out-Null
Write-Output $processId
`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, (_error, stdout) => {
      const pid = Number(String(stdout).trim())
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
    })
  })
}

async function openLoopback(pid: number, send: (chunk: Buffer) => void): Promise<LoopbackSession | null> {
  try {
    const loaded = (await import('loopback-capture')) as {
      LoopbackCapture?: new () => LoopbackHandle
      default?: { LoopbackCapture?: new () => LoopbackHandle }
    }
    const Capture = loaded.LoopbackCapture ?? loaded.default?.LoopbackCapture
    if (!Capture) return null
    const capture = new Capture()
    capture.start(pid, true, send)
    return { stop: () => capture.stop() }
  } catch (error) {
    console.warn('[audio] loopback-capture não carregou. Usando o loopback do sistema.', error)
    return null
  }
}

interface LoopbackHandle {
  start: (processId: number, includeTree: boolean, callback: (chunk: Buffer) => void) => void
  stop: () => void
}

export function registerProcessAudio(): void {
  ipcMain.handle('audio:process-start', async (event, sourceId: unknown) => {
    active?.stop()
    active = null
    target = event.sender
    if (process.platform !== 'win32' || typeof sourceId !== 'string') return false
    const hwnd = hwndFromSource(sourceId)
    if (!hwnd) return false
    const pid = await pidFromHwnd(hwnd)
    if (!pid) return false
    const session = await openLoopback(pid, (chunk) => {
      if (target && !target.isDestroyed()) target.send('audio:pcm', chunk)
    })
    if (!session) return false
    active = session
    return true
  })

  ipcMain.handle('audio:process-stop', () => {
    active?.stop()
    active = null
    target = null
  })
}

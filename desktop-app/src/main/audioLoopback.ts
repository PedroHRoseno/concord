import { execFile } from 'node:child_process'
import { ipcMain, type MessagePortMain } from 'electron'

interface LoopbackHandle {
  start: (processId: number, includeTree: boolean, callback: (chunk: Buffer) => void) => void
  stop: () => void
}

export interface AudioLoopbackStart {
  ok: boolean
  isolated: boolean
  pid: number | null
}

const failed: AudioLoopbackStart = { ok: false, isolated: false, pid: null }

let capture: LoopbackHandle | null = null
let port: MessagePortMain | null = null
let report: NodeJS.Timeout | null = null
let packets = 0
let peak = 0

function hwndFromSource(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const hwnd = Number(match[1])
  return Number.isInteger(hwnd) && hwnd > 0 ? hwnd : null
}

function pidFromHwnd(hwnd: number): Promise<number | null> {
  const script = `
if (-not ('ConcordPid' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConcordPid {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
}
$processId = [uint32]0
[ConcordPid]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$processId) | Out-Null
$current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
if (-not $current) { Write-Output $processId; exit 0 }
for ($i = 0; $i -lt 8; $i++) {
  if ($current.ParentProcessId -le 0) { break }
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)"
  if (-not $parent -or $parent.Name -ne $current.Name) { break }
  $current = $parent
}
Write-Output $current.ProcessId
`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, (_error, stdout) => {
      const lines = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const pid = Number(lines[lines.length - 1])
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
    })
  })
}

function publishChunk(chunk: Buffer): void {
  if (!port) return
  const copy = new Uint8Array(chunk.byteLength)
  copy.set(chunk)
  for (let index = 0; index + 1 < copy.byteLength; index += 64) {
    const sample = (copy[index] | (copy[index + 1] << 8)) << 16 >> 16
    const level = sample < 0 ? -sample : sample
    if (level > peak) peak = level
  }
  packets += 1
  try {
    port.postMessage(copy)
  } catch (error) {
    console.warn('[audio] falha ao enviar o PCM da janela', error)
  }
}

async function openLoopback(pid: number, includeTree: boolean): Promise<LoopbackHandle | null> {
  try {
    const loaded = (await import('loopback-capture')) as {
      LoopbackCapture?: new () => LoopbackHandle
      default?: { LoopbackCapture?: new () => LoopbackHandle }
    }
    const Capture = loaded.LoopbackCapture ?? loaded.default?.LoopbackCapture
    if (!Capture) return null
    const session = new Capture()
    session.start(pid, includeTree, publishChunk)
    return session
  } catch (error) {
    console.warn('[audio] loopback-capture não carregou', error)
    return null
  }
}

function stopCapture(): void {
  if (report) clearTimeout(report)
  report = null
  capture?.stop()
  capture = null
  packets = 0
  peak = 0
}

function armReport(label: string): void {
  if (report) clearTimeout(report)
  report = setTimeout(() => {
    report = null
    console.log(`[audio] ${label}: pacotes=${packets} pico=${peak}`)
  }, 1000)
}

export function registerAudioLoopback(): void {
  ipcMain.on('audio-loopback-port', (event) => {
    port?.close()
    const next = event.ports[0]
    port = next ?? null
    port?.start()
  })

  ipcMain.handle('audio-loopback-start', async (_event, sourceId: unknown): Promise<AudioLoopbackStart> => {
    stopCapture()
    if (process.platform !== 'win32' || typeof sourceId !== 'string') return failed

    if (sourceId.startsWith('window:')) {
      const hwnd = hwndFromSource(sourceId)
      if (!hwnd) return failed
      const pid = await pidFromHwnd(hwnd)
      if (!pid) return failed
      capture = await openLoopback(pid, true)
      if (!capture) return { ...failed, pid }
      armReport(`janela pid=${pid}`)
      console.log(`[audio] isolamento da janela pid=${pid}`)
      return { ok: true, isolated: true, pid }
    }

    if (sourceId.startsWith('screen:')) {
      // WASAPI só aceita uma árvore por ativação. Excluir o Electron tira o
      // eco de quem assiste dentro do Concord. O Discord fica de fora dessa exclusão.
      const pid = process.pid
      capture = await openLoopback(pid, false)
      if (!capture) return { ...failed, pid }
      armReport(`tela sem pid=${pid}`)
      console.log(`[audio] tela sem o processo ${pid} (Concord)`)
      return { ok: true, isolated: false, pid }
    }

    return failed
  })

  ipcMain.handle('audio-loopback-stop', () => {
    stopCapture()
  })
}

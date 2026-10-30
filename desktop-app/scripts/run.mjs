import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const minimum = [20, 12, 0]

function parts(version) {
  return version.split('.').map((piece) => Number(piece))
}

function isOlderThan(version, target) {
  const current = parts(version)
  for (let index = 0; index < target.length; index += 1) {
    const left = current[index] ?? 0
    const right = target[index]
    if (left < right) return true
    if (left > right) return false
  }
  return false
}

function readVersion(binary) {
  const result = spawnSync(binary, ['-p', 'process.versions.node'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.trim()
}

function findNode() {
  if (!isOlderThan(process.versions.node, minimum)) return process.execPath
  const candidates = []
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    candidates.push(`${process.env.ProgramFiles}\\nodejs\\node.exe`)
  }
  candidates.push('/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node')
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const version = readVersion(candidate)
    if (version && !isOlderThan(version, minimum)) return candidate
  }
  console.error(
    `Este comando está rodando no Node ${process.version} (${process.execPath}). Use Node.js 22 ou mais novo. Se node -v já mostra uma versão nova, um Node antigo instalado numa pasta pai está na frente do PATH do npm.`
  )
  process.exit(1)
}

function findCli() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  console.error('Não encontrei o electron-vite. Rode npm install na raiz do projeto.')
  process.exit(1)
}

function ensureElectron(node) {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    const install = join(dir, 'node_modules', 'electron', 'install.js')
    const binaryMarker = join(dir, 'node_modules', 'electron', 'path.txt')
    if (existsSync(install)) {
      if (!existsSync(binaryMarker)) {
        console.log('Baixando o runtime do Electron...')
        const download = spawnSync(node, [install], { stdio: 'inherit', cwd: dir })
        if ((download.status ?? 1) !== 0) process.exit(download.status ?? 1)
      }
      return
    }
    dir = dirname(dir)
  }
}

const node = findNode()
ensureElectron(node)
const result = spawnSync(node, [findCli(), ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd()
})

process.exit(result.status ?? 1)

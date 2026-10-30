import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const png = readFileSync(join(root, 'resources', 'icon.png'))
const ico = await pngToIco(png)
writeFileSync(join(root, 'resources', 'icon.ico'), ico)

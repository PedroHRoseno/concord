import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const fallbackVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const appVersion = process.env.VITE_APP_VERSION?.trim() || fallbackVersion

// Build web para o app mobile. Não entra no electron.vite.config.ts.
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  envDir: resolve('.'),
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion)
  },
  build: {
    outDir: resolve('dist-mobile'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5174,
    strictPort: true
  }
})

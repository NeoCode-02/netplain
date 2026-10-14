import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { externalizeDeps: false } },
  preload: {},
  renderer: { plugins: [react()], build: { minify: true } }
})

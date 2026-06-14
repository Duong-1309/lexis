import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: 'electron/main.ts',
        external: [
          'better-sqlite3',
          'electron-store',
          'electron-log',
          'kuromoji',
          'epubjs',
          '@mozilla/readability',
          'jsdom',
          'electron-updater',
          'electron-window-state',
        ],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: 'electron/preload.ts',
      },
    },
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: 'src/index.html',
      },
    },
    plugins: [react()],
  },
})

import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'electron/main.ts',
      },
      rollupOptions: {
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
      lib: {
        entry: 'electron/preload.ts',
      },
    },
  },
  renderer: {
    root: 'src',
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: 'src/index.html',
      },
    },
    plugins: [react()],
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/__tests__/**/*.test.ts'],
    // db.test.ts requires better-sqlite3 native module compiled for Electron;
    // cannot run under system Node. Covered by e2e tests in Sprint 6.
    exclude: ['electron/**/__tests__/db.test.ts'],
    globals: true,
  },
})

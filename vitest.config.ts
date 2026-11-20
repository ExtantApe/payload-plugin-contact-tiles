import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { testTimeout: 20_000, setupFiles: ['./test/setup.ts'], environmentMatchGlobs: [['test/**/*.dom.test.tsx', 'jsdom']] } })

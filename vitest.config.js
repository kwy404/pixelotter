import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit-*.test.js'],
    environment: 'node',
    setupFiles: ['test/unit-setup.js'],
    testTimeout: 60000,
  },
});

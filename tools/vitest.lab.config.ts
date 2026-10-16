import { defineConfig } from 'vitest/config';
// Physics lab: exploratory scenario sweeps and traces (not part of the CI suite).
// Usage: SCEN=turn,drift npx vitest run --config tools/vitest.lab.config.ts --reporter=verbose
export default defineConfig({
  test: { include: ['tools/**/*.test.ts'], environment: 'node', testTimeout: 120000, silent: false },
});

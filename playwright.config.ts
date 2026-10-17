import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build (vite preview), including the service worker.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } }, testIgnore: /mobile|portrait/ },
    { name: 'mobile', use: { ...devices['iPhone 13 landscape'], browserName: 'chromium' }, testMatch: /mobile/ },
    { name: 'portrait', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /portrait/ },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

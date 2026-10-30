import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/Lion-Patrol/`,
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['geolocation'],
    geolocation: { latitude: 47.3826, longitude: -122.2346, accuracy: 12 },
  },
  projects: [
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'], colorScheme: 'dark' } },
    { name: 'chromium-pixel7', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: `npm run build:e2e && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/Lion-Patrol/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

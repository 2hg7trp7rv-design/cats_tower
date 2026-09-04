import { defineConfig } from '@playwright/test';

const mobileProject = (
  name: string,
  browserName: 'chromium' | 'webkit',
  width: number,
  height: number,
) => ({
  name,
  use: {
    browserName,
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  },
});

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    mobileProject('chromium-320x568', 'chromium', 320, 568),
    mobileProject('chromium-390x844', 'chromium', 390, 844),
    mobileProject('chromium-430x932', 'chromium', 430, 932),
    mobileProject('webkit-390x844', 'webkit', 390, 844),
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

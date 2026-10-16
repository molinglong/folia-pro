import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
process.env.NO_PROXY = `${process.env.NO_PROXY ?? ''},127.0.0.1,localhost,::1`;
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
    testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false,
    timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'line',
    outputDir: '../../test-results/design-lab',
    use: {
        baseURL: 'http://127.0.0.1:5211', viewport: { width: 1500, height: 1100 },
        serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
        launchOptions: { executablePath: candidates.find((p): p is string => Boolean(p && existsSync(p))) },
    },
    // 独占测试端口，不借用或关闭用户的 5210 预览服务。
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config dev/design-lab/vite.config.ts --port 5211',
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        url: 'http://127.0.0.1:5211', reuseExistingServer: false, timeout: 60_000,
    },
});

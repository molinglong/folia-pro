import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev/design-lab/vite.config.ts
// @fork 独立设计试验台：不继承主应用的环境、代理、PWA 和缓存。
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
    root,
    envDir: false,
    publicDir: false,
    cacheDir: '../../node_modules/.vite-design-lab',
    plugins: [react()],
    css: { postcss: { plugins: [] } },
    server: {
        host: '127.0.0.1',
        port: 5210,
        strictPort: true,
        hmr: { overlay: false },
    },
    build: {
        outDir: '../../test-results/design-lab-build',
        emptyOutDir: false,
        rollupOptions: { input: { main: `${root}index.html`, frame: `${root}frame.html` } },
    },
});

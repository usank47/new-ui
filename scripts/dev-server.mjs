import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Bundle Tesseract offline OCR assets
spawnSync(process.execPath, [path.join(__dirname, 'bundle-tesseract-assets.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});

// 2. Start Express API backend (server.js)
const apiProc = spawn(process.execPath, [path.join(rootDir, 'server.js')], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env },
});

const cleanup = () => {
  try {
    if (apiProc && !apiProc.killed) {
      apiProc.kill('SIGTERM');
    }
  } catch {
    // ignore
  }
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);

// 3. Start Vite dev server on 0.0.0.0:3000
const viteServer = await createServer({
  configFile: path.join(rootDir, 'vite.config.js'),
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
});

await viteServer.listen();
viteServer.printUrls();

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execFileSync} from 'node:child_process';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

const sourceRepo = 'https://github.com/shellpig/pix-forge';
const commitPattern = /^[0-9a-f]{40}$/i;

function getSourceUrl(): string {
  let commit = process.env.WORKERS_CI_COMMIT_SHA?.trim();
  if (!commit || !commitPattern.test(commit)) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: import.meta.dirname,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return sourceRepo;
    }
  }
  return commitPattern.test(commit) ? `${sourceRepo}/tree/${commit}` : sourceRepo;
}

export default defineConfig(() => {
  return {
    define: {
      'import.meta.env.PIXFORGE_SOURCE_URL': JSON.stringify(getSourceUrl()),
    },
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

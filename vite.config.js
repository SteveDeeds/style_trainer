import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hasLocalLibrary = existsSync(fileURLToPath(new URL('./public/library.json', import.meta.url)));

export default defineConfig({
  base: process.env.PAGES_BASE || '/',
  publicDir: process.env.STYLE_TRAINER_PUBLIC === '1' || !hasLocalLibrary ? 'public-release' : 'public',
});

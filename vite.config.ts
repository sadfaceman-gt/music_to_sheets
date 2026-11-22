/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Same headers the coi-serviceworker adds on GitHub Pages (Design 3.2),
// so the dev server is cross-origin isolated too.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/music_to_sheets/',
  plugins: [react(), tailwindcss()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

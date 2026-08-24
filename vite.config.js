import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/points-tracker/ on GitHub Pages, so the
// built asset URLs need that subpath as their base. Locally, `npm run dev`
// serves from the same base at http://localhost:5173/points-tracker/.
export default defineConfig({
  base: '/points-tracker/',
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
});

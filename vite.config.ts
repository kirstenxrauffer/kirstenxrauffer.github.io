import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';

// User GitHub Pages sites (username.github.io) serve from the domain root,
// so base stays '/' (unlike project pages which need '/repo-name/').
export default defineConfig({
  base: '/',
  // Serve the root-level assets/ folder as Vite's static asset directory.
  // This makes /images/*.jpg and /textures/paper.jpg available at runtime.
  publicDir: 'assets',
  plugins: [react(), glsl()],
  optimizeDeps: {
    include: ['three/examples/jsm/loaders/GLTFLoader.js'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          gsap:  ['gsap'],
          p5:    ['p5', 'p5.brush'],
        },
      },
    },
  },
});

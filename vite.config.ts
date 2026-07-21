import { defineConfig } from 'vite'

// Relative base so the build works from any path: GitHub Pages serves this
// under /pyrocystis-prototype/, `vite preview` serves it from the root.
export default defineConfig({
  base: './',
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // Provider brand marks live in the repo-level assets/ dir (single
      // source of truth, imported ?raw into the ui package).
      allow: ['..'],
    },
  },
})

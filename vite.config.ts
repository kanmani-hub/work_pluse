import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.webp'],
      manifest: false, // We already have manifest.json in public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}']
        // By default, external requests (Supabase API) are not cached.
      }
    })
  ],
})

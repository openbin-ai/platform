import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Mirrors openapk-frontend/vite.config.ts — see it for the long-form
// rationale on why shared/'s third-party imports need explicit aliases.
const appNodeModules = path.resolve(__dirname, 'node_modules')

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@shared':            path.resolve(__dirname, '../shared'),
      'react':              path.join(appNodeModules, 'react'),
      'react-dom':          path.join(appNodeModules, 'react-dom'),
      'react-oidc-context': path.join(appNodeModules, 'react-oidc-context'),
      'oidc-client-ts':     path.join(appNodeModules, 'oidc-client-ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
})

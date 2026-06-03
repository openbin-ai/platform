import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Resolve third-party deps imported from files in repo-root `shared/` back
// into THIS app's node_modules. Without these, Rolldown walks up from the
// shared file's location and never finds them (there's no repo-root
// node_modules — that's the whole point of the "no workspace" choice).
// Mirrors the `paths` entries in tsconfig.app.json so build-time and
// type-time resolution stay in sync.
const appNodeModules = path.resolve(__dirname, 'node_modules')

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Soft monorepo: `@shared/*` resolves to repo-root shared/. Matches the
      // `paths` entry in tsconfig.app.json; both must agree.
      '@shared':            path.resolve(__dirname, '../shared'),
      'react':              path.join(appNodeModules, 'react'),
      'react-dom':          path.join(appNodeModules, 'react-dom'),
      'react-oidc-context': path.join(appNodeModules, 'react-oidc-context'),
      'oidc-client-ts':     path.join(appNodeModules, 'oidc-client-ts'),
    },
    // Defend against the dual-react hazard: even with the aliases above, an
    // intermediate dep could try to walk up and find its own copy. dedupe
    // forces a single physical react instance in the bundle.
    dedupe: ['react', 'react-dom'],
  },
})

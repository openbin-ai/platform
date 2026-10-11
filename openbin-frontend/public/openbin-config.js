// Runtime configuration hook for self-hosted installs.
//
// The container entrypoint overwrites this file with something like:
//   window.__OPENBIN_CONFIG__ = { apiBase: "https://api.example", authority: "https://auth.example/realms/openapk", installBase: "https://app.example/downloads", selfHosted: true }
// On the hosted product and in dev it stays empty and the Vite env applies.

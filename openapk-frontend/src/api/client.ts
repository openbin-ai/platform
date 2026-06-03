// Re-export shim. Real implementation lives in the repo-root `shared/`
// directory so openbin-frontend can consume the same client. Existing
// `from '.../api/client'` imports inside openapk-frontend keep working
// unchanged; new code in either app should import from `@shared/api/client`.
export * from '@shared/api/client'

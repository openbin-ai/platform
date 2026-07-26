/**
 * Bundle API types (openbin-only — bundles group multiple native-binary
 * projects into one sample). Mirrors the backend BundleSummary / BundleDetail
 * DTOs. Member files reuse the ProjectResponse shape; we only type the fields
 * the bundle UI reads.
 */

export type BundleSummary = {
  id: string
  name: string
  createdAt: string
  fileCount: number
}

export type BundleFile = {
  id: string
  kind: 'APK' | 'BIN' | 'SCRIPT'
  name: string
  originalFilename: string
  sizeBytes: number
  status: 'UPLOADED' | 'DECOMPILING' | 'INGEST_PENDING' | 'READY' | 'FAILED'
  arch: string | null
  executableFormat: string | null
  createdAt: string
  publicReadAt: string | null
  bundleId: string | null
}

export type BundleDetail = {
  id: string
  name: string
  createdAt: string
  files: BundleFile[]
}

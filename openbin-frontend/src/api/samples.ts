// Multi-sample projects: the ADDITIONAL samples attached to a BIN project.
// The project's primary sample stays on the project row / the existing
// /binary-analysis surface; these types mirror core's SampleView DTO
// (projects/samples/dto/SampleView.java).

export type ProjectSampleStatus = 'INGEST_PENDING' | 'READY' | 'FAILED'

export type ProjectSample = {
  id: string
  label: string
  originalFilename: string | null
  sha256: string
  sizeBytes: number
  arch: string | null
  executableFormat: string | null
  compiler: string | null
  languageId: string | null
  imageBase: string | null
  status: ProjectSampleStatus
  errorMessage: string | null
  createdAt: string
  analyzedAt: string | null
  // Short-TTL CloudFront signed URL for the raw worker JSON; null when not
  // READY or CDN signing is off — fall back to
  // GET /api/projects/{id}/samples/{sampleId}/binary-analysis.
  analysisDownloadUrl: string | null
  analysisSizeBytes: number
}

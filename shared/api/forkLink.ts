// Where the "🍴 forked" attribution on a fork should link to.
//
// You normally fork a project you do NOT own — that's the whole point of the
// community fork button — so the authenticated view of the source 404s for
// you. The first cut linked there unconditionally and every fork of a
// community project dead-ended. When the source is public, the public view is
// the one that's guaranteed to load for whoever is looking.
//
// `forkedFromPublic` is only populated on the project-detail and fork
// responses; anything else reports false, which falls back to the
// authenticated link — correct for the case that actually renders this
// (a fork of your own project).

export type ForkAttribution = {
  forkedFromId?: string | null
  forkedFromPublic?: boolean
}

/** Href for the source project, or null when this isn't a fork. */
export function forkedFromHref(project: ForkAttribution): string | null {
  if (!project.forkedFromId) return null
  return project.forkedFromPublic
    ? `/public/projects/${project.forkedFromId}`
    : `/projects/${project.forkedFromId}`
}

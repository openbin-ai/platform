// Fired on the window when something other than the report editor wrote to
// the project report (BINNY light's write_report_section). A mounted editor
// with no unsaved edits refetches so its next save does not overwrite the
// agent's section with a stale copy.
export const REPORT_CHANGED_EVENT = 'openbin:report:changed'

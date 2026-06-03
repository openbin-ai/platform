package ai.openapk.core.reports;

/**
 * Soft tag on a {@link ReportTemplate}. ANY = shows up regardless of project
 * mode; the others scope the picker to a single mode. Apply still works
 * cross-mode — this is a UI hint, not a hard constraint.
 */
public enum TemplateMode {
    MALWARE,
    VULN_RESEARCH,
    ANY
}

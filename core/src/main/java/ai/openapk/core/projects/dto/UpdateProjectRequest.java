package ai.openapk.core.projects.dto;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.WorkflowStatus;
import jakarta.validation.constraints.Size;

/**
 * Partial-update payload for PATCH /api/projects/{id}. Any null field is left
 * unchanged. Setting workflowStatus to PUBLISHED is rejected — clients must
 * use POST /report/publish instead so we can also set the publishedAt timestamp.
 */
public record UpdateProjectRequest(
        @Size(min = 1, max = 200) String name,
        // Null = unchanged; blank = clear. Up to 4000 chars of plain text.
        @Size(max = 4000) String description,
        WorkflowStatus workflowStatus,
        AnalysisMode analysisMode
) {}

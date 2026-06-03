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
        WorkflowStatus workflowStatus,
        AnalysisMode analysisMode
) {}

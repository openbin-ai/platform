package ai.openapk.core.reports.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Anonymous "report abuse" payload. We accept an optional reporter email
 * so we can follow up if needed, but never require it — anonymous flags
 * are still useful. Reason text is capped so the SES email body is
 * bounded.
 */
public record AbuseReportRequest(
        @NotBlank @Size(max = 2000, message = "reason too long") String reason,
        @Email @Size(max = 200, message = "email too long") String reporterEmail
) {}

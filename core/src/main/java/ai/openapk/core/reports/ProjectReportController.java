package ai.openapk.core.reports;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.reports.dto.ApplyTemplateRequest;
import ai.openapk.core.reports.dto.CommunityPublishRequest;
import ai.openapk.core.reports.dto.PopulateRequest;
import ai.openapk.core.reports.dto.ReportResponse;
import ai.openapk.core.reports.dto.ReportTemplateResponse;
import ai.openapk.core.reports.dto.SaveAsTemplateRequest;
import ai.openapk.core.reports.dto.UpdateReportRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/report")
public class ProjectReportController {

    private final ProjectReportService service;
    private final ReportTemplateService templateService;
    private final CurrentUserService currentUser;

    public ProjectReportController(
            ProjectReportService service,
            ReportTemplateService templateService,
            CurrentUserService currentUser
    ) {
        this.service = service;
        this.templateService = templateService;
        this.currentUser = currentUser;
    }

    @GetMapping
    public ReportResponse get(@PathVariable("id") UUID id) {
        return service.getOrCreate(currentUser.current(), id);
    }

    @PutMapping
    public ReportResponse update(@PathVariable("id") UUID id, @Valid @RequestBody UpdateReportRequest req) {
        return service.update(currentUser.current(), id, req);
    }

    @PostMapping("/populate")
    public ReportResponse populate(@PathVariable("id") UUID id, @Valid @RequestBody PopulateRequest req) {
        return service.populate(currentUser.current(), id, req);
    }

    @PostMapping("/publish")
    public ReportResponse publish(@PathVariable("id") UUID id) {
        return service.publish(currentUser.current(), id);
    }

    @PostMapping("/unpublish")
    public ReportResponse unpublish(@PathVariable("id") UUID id) {
        return service.unpublish(currentUser.current(), id);
    }

    /**
     * Publish the report to the anonymous /community feed. Body carries
     * the STIX 2.1 malware-type + free-form tags chosen at publish time.
     * Implicitly locks (publishedAt) the report if not already locked.
     */
    @PostMapping("/community/publish")
    public ReportResponse publishToCommunity(
            @PathVariable("id") UUID id,
            @Valid @RequestBody CommunityPublishRequest req
    ) {
        return service.publishToCommunity(currentUser.current(), id, req);
    }

    /**
     * Hide the report from the /community feed. Does NOT un-lock the
     * report — call /unpublish separately if you want to edit again.
     */
    @PostMapping("/community/unpublish")
    public ReportResponse unpublishFromCommunity(@PathVariable("id") UUID id) {
        return service.unpublishFromCommunity(currentUser.current(), id);
    }

    @PostMapping("/apply-template")
    public ReportResponse applyTemplate(@PathVariable("id") UUID id, @Valid @RequestBody ApplyTemplateRequest req) {
        return templateService.applyToProject(currentUser.current(), id, req);
    }

    @PostMapping("/save-as-template")
    public ReportTemplateResponse saveAsTemplate(@PathVariable("id") UUID id, @Valid @RequestBody SaveAsTemplateRequest req) {
        return templateService.saveFromProject(currentUser.current(), id, req);
    }

    @GetMapping(value = "/export.md", produces = "text/markdown")
    public ResponseEntity<byte[]> exportMarkdown(@PathVariable("id") UUID id) {
        String md = service.exportMarkdown(currentUser.current(), id);
        byte[] bytes = md.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"openapk-report-" + id + ".md\"")
                .contentType(MediaType.parseMediaType("text/markdown; charset=utf-8"))
                .contentLength(bytes.length)
                .body(bytes);
    }
}

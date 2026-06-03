package ai.openapk.core.reports;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.reports.dto.CreateReportTemplateRequest;
import ai.openapk.core.reports.dto.ReportTemplateResponse;
import ai.openapk.core.reports.dto.UpdateReportTemplateRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/report-templates")
public class ReportTemplateController {

    private final ReportTemplateService service;
    private final CurrentUserService currentUser;

    public ReportTemplateController(ReportTemplateService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<ReportTemplateResponse> list() {
        return service.list(currentUser.current());
    }

    @GetMapping("/{id}")
    public ReportTemplateResponse get(@PathVariable("id") UUID id) {
        return service.get(currentUser.current(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ReportTemplateResponse create(@Valid @RequestBody CreateReportTemplateRequest req) {
        return service.create(currentUser.current(), req);
    }

    @PutMapping("/{id}")
    public ReportTemplateResponse update(@PathVariable("id") UUID id, @Valid @RequestBody UpdateReportTemplateRequest req) {
        return service.update(currentUser.current(), id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable("id") UUID id) {
        service.delete(currentUser.current(), id);
    }
}

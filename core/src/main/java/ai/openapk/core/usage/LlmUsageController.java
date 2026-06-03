package ai.openapk.core.usage;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.usage.dto.AuditEntryResponse;
import ai.openapk.core.usage.dto.UpdateLimitsRequest;
import ai.openapk.core.usage.dto.UsageSummaryResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/usage")
public class LlmUsageController {

    private final LlmUsageService service;
    private final CurrentUserService currentUser;

    public LlmUsageController(LlmUsageService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping("/summary")
    public UsageSummaryResponse summary() {
        return service.summary(currentUser.current());
    }

    @GetMapping("/audit")
    public Page<AuditEntryResponse> audit(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        return service.auditPage(currentUser.current(), page, size);
    }

    @PutMapping("/limits")
    public UsageSummaryResponse updateLimits(@Valid @RequestBody UpdateLimitsRequest req) {
        return service.updateLimits(currentUser.current(), req);
    }
}

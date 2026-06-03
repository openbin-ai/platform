package ai.openapk.core.usage;

import ai.openapk.core.auth.User;
import ai.openapk.core.usage.dto.AuditEntryResponse;
import ai.openapk.core.usage.dto.UpdateLimitsRequest;
import ai.openapk.core.usage.dto.UsageSummaryResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * Centralizes audit logging + budget enforcement for every LLM call. The
 * invokers (sync + streaming) consult this service before/after each call so
 * neither the call sites nor the invokers themselves need to know about quotas.
 *
 * <p>Budget windows are UTC-day and UTC-month. Choosing UTC over a per-user
 * timezone keeps the math trivial — users see the same cutover regardless of
 * where they sit, which is fine for a self-hosted product where ops cares about
 * stability more than midnight-locality. Revisit if a tenant complains.
 */
@Service
public class LlmUsageService {

    private static final Logger log = LoggerFactory.getLogger(LlmUsageService.class);

    private final LlmAuditRepository auditRepo;
    private final LlmUserLimitsRepository limitsRepo;

    public LlmUsageService(LlmAuditRepository auditRepo, LlmUserLimitsRepository limitsRepo) {
        this.auditRepo = auditRepo;
        this.limitsRepo = limitsRepo;
    }

    /**
     * Hard gate before an LLM call. Throws 429 if the user is already at or past
     * any of their caps. We don't try to predict the call's token count — the
     * audit row written after the call will surface the overshoot, and any single
     * call's overshoot is bounded by the {@code maxTokens} parameter the caller
     * passes anyway. Tracks total spent so the message tells the user how much
     * room they have left.
     */
    @Transactional(readOnly = true)
    public void checkBudget(User user) {
        LlmUserLimits limits = limitsRepo.findByUserId(user.getId()).orElse(null);
        if (limits == null) return; // no row = unlimited
        if (limits.getDailyTokenCap() == null && limits.getMonthlyTokenCap() == null) return;

        if (limits.getDailyTokenCap() != null) {
            long today = auditRepo.sumTokensSince(user.getId(), startOfTodayUtc());
            if (today >= limits.getDailyTokenCap()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        formatLimitMessage("daily", today, limits.getDailyTokenCap()));
            }
        }
        if (limits.getMonthlyTokenCap() != null) {
            long month = auditRepo.sumTokensSince(user.getId(), startOfThisMonthUtc());
            if (month >= limits.getMonthlyTokenCap()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        formatLimitMessage("monthly", month, limits.getMonthlyTokenCap()));
            }
        }
    }

    /**
     * Persist one audit row. Called in finally / onDone / onError paths so a
     * thrown exception inside doesn't mask the original LLM failure. Runs in
     * REQUIRES_NEW so a rolled-back outer transaction (e.g. when the LLM call
     * itself fails and the caller's transaction unwinds) doesn't lose the audit
     * trail — the whole point of an audit log is that it survives the failure.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            User user,
            UUID projectId,
            String provider,
            String model,
            String purpose,
            int inputTokens,
            int outputTokens,
            boolean success,
            String errorMessage
    ) {
        try {
            var e = new LlmAuditEntry();
            e.setUser(user);
            e.setProjectId(projectId);
            e.setProvider(provider);
            e.setModel(model == null ? "?" : model);
            e.setPurpose(purpose == null ? "unknown" : purpose);
            e.setInputTokens(Math.max(0, inputTokens));
            e.setOutputTokens(Math.max(0, outputTokens));
            e.setSuccess(success);
            e.setErrorMessage(errorMessage == null ? null
                    : errorMessage.length() > 1000 ? errorMessage.substring(0, 1000) : errorMessage);
            auditRepo.save(e);
        } catch (Exception ex) {
            // Never let an audit failure propagate into the caller — it would
            // turn a successful LLM call into a 500.
            log.warn("audit write failed for user={} purpose={}: {}", user.getId(), purpose, ex.toString());
        }
    }

    @Transactional(readOnly = true)
    public UsageSummaryResponse summary(User user) {
        long today = auditRepo.sumTokensSince(user.getId(), startOfTodayUtc());
        long month = auditRepo.sumTokensSince(user.getId(), startOfThisMonthUtc());
        long total = auditRepo.sumTokensSince(user.getId(), Instant.EPOCH);
        long calls = auditRepo.findAllByUserIdOrderByCreatedAtDesc(user.getId(), PageRequest.of(0, 1))
                .getTotalElements();
        Long dailyCap = null, monthlyCap = null;
        LlmUserLimits limits = limitsRepo.findByUserId(user.getId()).orElse(null);
        if (limits != null) {
            dailyCap = limits.getDailyTokenCap();
            monthlyCap = limits.getMonthlyTokenCap();
        }
        return new UsageSummaryResponse(
                today, month, dailyCap, monthlyCap,
                startOfTomorrowUtc().toString(),
                startOfNextMonthUtc().toString(),
                calls, total
        );
    }

    @Transactional(readOnly = true)
    public Page<AuditEntryResponse> auditPage(User user, int page, int size) {
        return auditRepo.findAllByUserIdOrderByCreatedAtDesc(
                user.getId(),
                PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 200))
        ).map(AuditEntryResponse::from);
    }

    @Transactional
    public UsageSummaryResponse updateLimits(User user, UpdateLimitsRequest req) {
        LlmUserLimits limits = limitsRepo.findByUserId(user.getId()).orElseGet(() -> {
            var fresh = new LlmUserLimits();
            fresh.setUser(user);
            return fresh;
        });
        limits.setDailyTokenCap(req.dailyTokenCap());
        limits.setMonthlyTokenCap(req.monthlyTokenCap());
        limitsRepo.save(limits);
        return summary(user);
    }

    private static Instant startOfTodayUtc() {
        return LocalDate.now(ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private static Instant startOfTomorrowUtc() {
        return LocalDate.now(ZoneOffset.UTC).plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private static Instant startOfThisMonthUtc() {
        return YearMonth.now(ZoneOffset.UTC).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private static Instant startOfNextMonthUtc() {
        return YearMonth.now(ZoneOffset.UTC).plusMonths(1).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private static String formatLimitMessage(String window, long used, long cap) {
        return String.format(
                "LLM %s token budget exhausted (%,d / %,d used). Raise the cap in Settings → Usage to continue.",
                window, used, cap
        );
    }
}

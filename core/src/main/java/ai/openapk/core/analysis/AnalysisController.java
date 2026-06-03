package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.AnalysisRequest;
import ai.openapk.core.analysis.dto.AnalysisResponse;
import ai.openapk.core.analysis.dto.AskFunctionRequest;
import ai.openapk.core.analysis.dto.AskRequest;
import ai.openapk.core.analysis.dto.AskResponse;
import ai.openapk.core.auth.CurrentUserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executor;

@RestController
@RequestMapping("/api/projects/{id}")
public class AnalysisController {

    private final AnalysisService service;
    private final CurrentUserService currentUser;
    private final Executor aiStreamExecutor;

    public AnalysisController(
            AnalysisService service,
            CurrentUserService currentUser,
            @Qualifier("aiStreamExecutor") Executor aiStreamExecutor
    ) {
        this.service = service;
        this.currentUser = currentUser;
        this.aiStreamExecutor = aiStreamExecutor;
    }

    @PostMapping("/analyze")
    public AnalysisResponse analyze(@PathVariable("id") UUID id, @Valid @RequestBody AnalysisRequest req) {
        return service.analyze(currentUser.current(), id, req.mode(), req.credentialId(), req.model());
    }

    /**
     * Return the cached /analyze result for this project, or 204 No Content
     * when none has been computed yet. Used by the Analysis tab to rehydrate
     * after a page refresh without re-spending tokens.
     */
    @GetMapping("/analysis")
    public ResponseEntity<AnalysisResponse> latestAnalysis(@PathVariable("id") UUID id) {
        AnalysisResponse cached = service.latestAnalysis(currentUser.current(), id);
        if (cached == null) return ResponseEntity.noContent().build();
        return ResponseEntity.ok(cached);
    }

    /**
     * Re-runs the static digest scan (cheap, no LLM) and overwrites the cache.
     * Lets users pick up new signature patterns without paying for a full /analyze.
     */
    @PostMapping("/digest/rescan")
    public void rescanDigest(@PathVariable("id") UUID id) {
        service.rescanDigest(currentUser.current(), id);
    }

    @PostMapping("/ask")
    public AskResponse ask(@PathVariable("id") UUID id, @Valid @RequestBody AskRequest req) {
        return service.ask(currentUser.current(), id, req.filePath(), req.question(), req.credentialId(), req.model());
    }

    @PostMapping(value = "/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter askStream(@PathVariable("id") UUID id, @Valid @RequestBody AskRequest req) {
        var emitter = new SseEmitter(Duration.ofMinutes(5).toMillis());
        var user = currentUser.current();
        aiStreamExecutor.execute(() -> service.streamAsk(
                emitter, user, id, req.filePath(), req.question(),
                req.credentialId(), req.model(), req.priorTurns()
        ));
        return emitter;
    }

    /**
     * BIN-only function-level Q&A. Context loaded from the cached worker JSON
     * (function's signature + decompiled C + first ~500 disasm lines).
     */
    @PostMapping(value = "/ask-function/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter askFunctionStream(@PathVariable("id") UUID id, @Valid @RequestBody AskFunctionRequest req) {
        var emitter = new SseEmitter(Duration.ofMinutes(5).toMillis());
        var user = currentUser.current();
        aiStreamExecutor.execute(() -> service.streamAskFunction(
                emitter, user, id, req.functionName(), req.question(),
                req.credentialId(), req.model(), req.priorTurns()
        ));
        return emitter;
    }
}

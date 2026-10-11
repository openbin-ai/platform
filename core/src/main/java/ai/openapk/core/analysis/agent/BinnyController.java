package ai.openapk.core.analysis.agent;

import ai.openapk.core.analysis.agent.dto.BinnyRequest;
import ai.openapk.core.auth.CurrentUserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * BINNY light: the in-browser agent. One endpoint for every project kind;
 * the service picks context and tools from the project. SSE events:
 * {@code chunk}, {@code tool_call}, {@code tool_result}, {@code done},
 * {@code error}. A loop with several tool calls can run well past a single
 * ask, hence the longer emitter timeout.
 */
@RestController
@RequestMapping("/api/projects/{id}/binny")
public class BinnyController {

    private final BinnyAgentService service;
    private final CurrentUserService currentUser;
    private final Executor aiStreamExecutor;

    public BinnyController(BinnyAgentService service, CurrentUserService currentUser,
                           @Qualifier("aiStreamExecutor") Executor aiStreamExecutor) {
        this.service = service;
        this.currentUser = currentUser;
        this.aiStreamExecutor = aiStreamExecutor;
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable("id") UUID id, @Valid @RequestBody BinnyRequest req) {
        var emitter = new SseEmitter(Duration.ofMinutes(10).toMillis());
        var user = currentUser.current();
        aiStreamExecutor.execute(() -> service.stream(emitter, user, id, req));
        return emitter;
    }
}

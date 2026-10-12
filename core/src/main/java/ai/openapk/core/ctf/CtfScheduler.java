package ai.openapk.core.ctf;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Announces challenges on Discord once their window opens. Runs every minute. */
@Component
public class CtfScheduler {

    private final CtfService service;

    public CtfScheduler(CtfService service) {
        this.service = service;
    }

    @Scheduled(fixedDelay = 60_000L, initialDelay = 30_000L)
    public void announceStarted() {
        service.announceStartedChallenges();
    }
}

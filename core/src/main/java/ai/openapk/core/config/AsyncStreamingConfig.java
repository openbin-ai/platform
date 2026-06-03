package ai.openapk.core.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
public class AsyncStreamingConfig {

    /**
     * Separate from the single-threaded decompile executor: each AI stream holds a
     * thread for the whole call (5–60s for typical responses), so we need a small
     * pool sized for concurrent users. Bumping max pool when we have more memory
     * headroom is fine.
     */
    @Bean(name = "aiStreamExecutor")
    public Executor aiStreamExecutor() {
        var exec = new ThreadPoolTaskExecutor();
        exec.setCorePoolSize(4);
        exec.setMaxPoolSize(8);
        exec.setQueueCapacity(20);
        exec.setThreadNamePrefix("ai-stream-");
        exec.setWaitForTasksToCompleteOnShutdown(true);
        exec.setAwaitTerminationSeconds(30);
        exec.initialize();
        return exec;
    }
}

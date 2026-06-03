package ai.openapk.core.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
@EnableAsync
@EnableScheduling
public class AsyncConfig {

    /**
     * Single-threaded executor for JADX decompilation jobs. Sequential processing keeps
     * memory usage predictable (JADX loads the whole DEX into memory) and avoids
     * starving the request-handling pool. Bumping core/max pool size when we have
     * resource isolation is a future optimization.
     */
    @Bean(name = "decompileExecutor")
    public Executor decompileExecutor() {
        var exec = new ThreadPoolTaskExecutor();
        exec.setCorePoolSize(1);
        exec.setMaxPoolSize(1);
        exec.setQueueCapacity(50);
        exec.setThreadNamePrefix("decompile-");
        exec.setWaitForTasksToCompleteOnShutdown(true);
        exec.setAwaitTerminationSeconds(30);
        exec.initialize();
        return exec;
    }

    /**
     * Pool for native-library Ghidra analysis jobs. We bound it small because
     * each job blocks on the Ghidra worker (minutes per .so) and we don't want
     * a single project's many .so files to starve other tenants. Independent
     * APK uploads don't compete with these jobs — JADX has its own pool.
     */
    @Bean(name = "nativeAnalysisExecutor")
    public Executor nativeAnalysisExecutor() {
        var exec = new ThreadPoolTaskExecutor();
        exec.setCorePoolSize(2);
        exec.setMaxPoolSize(4);
        exec.setQueueCapacity(50);
        exec.setThreadNamePrefix("native-");
        exec.setWaitForTasksToCompleteOnShutdown(true);
        exec.setAwaitTerminationSeconds(30);
        exec.initialize();
        return exec;
    }
}

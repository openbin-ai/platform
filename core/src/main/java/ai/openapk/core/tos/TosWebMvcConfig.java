package ai.openapk.core.tos;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers {@link TosAcceptanceFilter} as a Spring MVC interceptor.
 * Scoped to {@code /api/**} only — the interceptor's own internal
 * EXEMPT_PREFIXES still applies inside that scope (TOS endpoints
 * themselves, community feed, etc.).
 */
@Configuration
public class TosWebMvcConfig implements WebMvcConfigurer {

    private final TosAcceptanceFilter filter;

    public TosWebMvcConfig(TosAcceptanceFilter filter) {
        this.filter = filter;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(filter).addPathPatterns("/api/**");
    }
}

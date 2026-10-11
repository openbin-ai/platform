package ai.openapk.core.credentials;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Pushes {@code openapk.llm.egress-allowlist} into {@link EgressUrlPolicy}
 * at startup. The policy is a static utility (it is called from four
 * unrelated egress paths), so this is the one place configuration enters
 * it. Logs loudly when non-empty: it widens the SSRF boundary on purpose
 * and an operator reading the boot log should see that.
 */
@Component
public class EgressAllowlistConfigurer {

    private static final Logger log = LoggerFactory.getLogger(EgressAllowlistConfigurer.class);

    public EgressAllowlistConfigurer(@Value("${openapk.llm.egress-allowlist:}") String csv) {
        EgressUrlPolicy.configureAllowlist(csv);
        if (csv != null && !csv.isBlank()) {
            log.warn("LLM egress allowlist active (private destinations permitted): {}", csv.trim());
        }
    }
}

package ai.openapk.core.web;

import ai.openapk.core.config.OpenApkProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Unauthenticated description of where this deployment lives. The web apps
 * read it to build instance-local install instructions, and the CLI reads
 * it on {@code openbin login --server <api-url>} so a self-hosted analyst
 * only has to know one URL. Nothing here is secret: every value is also
 * visible in the browser's address bar or the OIDC discovery document.
 */
@RestController
public class PublicConfigController {

    private static final String REALM_SUFFIX = "/realms/";

    private final OpenApkProperties.Web web;
    private final String issuerUri;

    public PublicConfigController(OpenApkProperties props,
                                  @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuerUri) {
        this.web = props.web();
        this.issuerUri = issuerUri;
    }

    @GetMapping("/api/public/config")
    public Map<String, Object> config() {
        var out = new LinkedHashMap<String, Object>();
        out.put("selfHosted", Boolean.TRUE.equals(web.selfHosted()));
        out.put("authUrl", authUrl());
        out.put("issuerUri", issuerUri);
        out.put("openbinWebUrl", trim(web.openbinUrl()));
        out.put("openapkWebUrl", trim(web.openapkUrl()));
        out.put("downloadsBase", trim(web.downloadsBase()));
        return out;
    }

    /** Explicit public auth URL, else the issuer URI with its realm path removed. */
    private String authUrl() {
        if (web.authUrl() != null && !web.authUrl().isBlank()) return trim(web.authUrl());
        int i = issuerUri.indexOf(REALM_SUFFIX);
        return i > 0 ? issuerUri.substring(0, i) : trim(issuerUri);
    }

    private static String trim(String s) {
        return s == null ? null : s.replaceAll("/+$", "");
    }
}

package ai.openapk.core.projects.analysis;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.services.cloudfront.CloudFrontUtilities;
import software.amazon.awssdk.services.cloudfront.model.CannedSignerRequest;
import software.amazon.awssdk.services.cloudfront.url.SignedUrl;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

/**
 * Mints time-bound CloudFront-signed GET URLs for analysis blobs. Uses a
 * <em>canned policy</em> (the simpler of CloudFront's two signing schemes) —
 * the URL is bound to one resource path and one expiry. We don't need
 * custom policies because we never want to restrict by IP/CIDR or sign a
 * wildcard path.
 *
 * <p>Configured-but-key-missing is a soft error: {@code sign()} returns null
 * and the caller (ProjectResponse builder) just omits the URL so the
 * legacy JSONB inline path stays usable. This keeps Phase 1 bring-up
 * resilient to misconfiguration without blocking the existing flow.
 */
public class CloudFrontUrlSigner {

    private static final Logger log = LoggerFactory.getLogger(CloudFrontUrlSigner.class);

    private final CloudFrontUtilities utilities;
    private final String distributionDomain;
    private final String keyPairId;
    private final Path privateKeyPath;

    CloudFrontUrlSigner(CloudFrontUtilities utilities,
                        String distributionDomain,
                        String keyPairId,
                        Path privateKeyPath) {
        this.utilities = utilities;
        this.distributionDomain = distributionDomain;
        this.keyPairId = keyPairId;
        this.privateKeyPath = privateKeyPath;
    }

    public boolean isConfigured() {
        return distributionDomain != null && keyPairId != null && privateKeyPath != null;
    }

    /**
     * Signs a GET URL for {@code s3Key} (e.g. "analysis/{u}/{p}/result.json.gz")
     * via the configured CloudFront distribution, valid for {@code ttl}.
     * Returns null if signing isn't configured — caller falls back to
     * legacy inline JSONB.
     */
    public String sign(String s3Key, Duration ttl) {
        if (!isConfigured()) return null;
        String resourceUrl = "https://" + distributionDomain + "/" + s3Key;
        try {
            CannedSignerRequest req = CannedSignerRequest.builder()
                    .resourceUrl(resourceUrl)
                    .keyPairId(keyPairId)
                    .privateKey(privateKeyPath)
                    .expirationDate(Instant.now().plus(ttl))
                    .build();
            SignedUrl signed = utilities.getSignedUrlWithCannedPolicy(req);
            return signed.url();
        } catch (Exception e) {
            // Never throw to the request thread — losing a signed URL just
            // means the frontend falls back to JSONB. Log loud so prod
            // ops notices.
            log.error("CloudFront sign failed for key={} ttl={}: {}", s3Key, ttl, e.toString());
            return null;
        }
    }
}

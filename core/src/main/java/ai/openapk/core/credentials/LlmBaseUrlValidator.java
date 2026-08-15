package ai.openapk.core.credentials;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;

/**
 * SSRF guard for the {@link LlmProvider#OPENAI_COMPAT} provider's
 * user-supplied {@code baseUrl}. Every OpenAI-compatible call path (test,
 * model listing, and every chat-completion request — sync and streaming)
 * makes an outbound HTTP request to this URL from the app server's own
 * network position, and hands the response back to the caller (as the test
 * result, the model list, or streamed chat text). Left unvalidated, any
 * authenticated user could point it at an internal-only target — the cloud
 * metadata service, the ECS task-role credentials endpoint, Keycloak,
 * Postgres/MinIO admin surfaces — and read the response back out.
 *
 * <p>Call {@link #validate} immediately before each outbound request (not
 * just once at credential-create time): re-resolving right before use
 * shrinks the window for a DNS-rebinding bypass, where a hostname that
 * resolved to a public address at creation time is repointed at a private
 * one before the credential is actually used.
 */
public final class LlmBaseUrlValidator {

    private LlmBaseUrlValidator() {}

    public static void validate(String rawUrl) {
        URI uri;
        try {
            uri = new URI(rawUrl);
        } catch (URISyntaxException e) {
            throw reject("not a valid URL");
        }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            throw reject("must be http or https");
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw reject("missing host");
        }

        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw reject("host does not resolve");
        }
        if (addresses.length == 0) {
            throw reject("host does not resolve");
        }
        for (InetAddress addr : addresses) {
            if (isDisallowed(addr)) {
                throw reject("resolves to a non-public address");
            }
        }
    }

    private static boolean isDisallowed(InetAddress addr) {
        return addr.isAnyLocalAddress()
                || addr.isLoopbackAddress()
                || addr.isLinkLocalAddress()      // covers 169.254.0.0/16 (cloud metadata) + fe80::/10
                || addr.isSiteLocalAddress()       // covers RFC1918 (10/8, 172.16/12, 192.168/16)
                || addr.isMulticastAddress()
                || isCarrierGradeNat(addr)
                || isUniqueLocalIpv6(addr);
    }

    /** 100.64.0.0/10 — used internally by several cloud providers, not covered by isSiteLocalAddress. */
    private static boolean isCarrierGradeNat(InetAddress addr) {
        if (!(addr instanceof Inet4Address)) return false;
        byte[] b = addr.getAddress();
        int first = b[0] & 0xFF;
        int second = b[1] & 0xFF;
        return first == 100 && (second & 0xC0) == 64;
    }

    /** fc00::/7 — IPv6 unique local addresses; isSiteLocalAddress only covers the deprecated fec0::/10. */
    private static boolean isUniqueLocalIpv6(InetAddress addr) {
        byte[] b = addr.getAddress();
        return b.length == 16 && (b[0] & 0xFE) == 0xFC;
    }

    private static ResponseStatusException reject(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "base URL rejected: " + reason);
    }
}

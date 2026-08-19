package ai.openapk.core.credentials;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.List;

/**
 * Where the server is allowed to make an outbound request on a user's behalf.
 *
 * <p>The OPENAI_COMPAT provider lets any authenticated user store an arbitrary
 * {@code baseUrl}, and we then fetch it from inside the VPC on four paths:
 * credential test, model listing, chat completion, and streaming. Without a
 * check that is a server-side request forgery primitive — the caller picks an
 * internal address and reads what comes back (directly from the model list, or
 * out of the upstream error body, which surfaces in the credential-test
 * result).
 *
 * <p>Policy: resolve the host and require EVERY address to be publicly
 * routable. All-not-any, so a hostname with one public and one internal A
 * record doesn't get through on a lucky round-robin.
 *
 * <p>Two design notes worth keeping:
 *
 * <ul>
 * <li><b>Prefix table, not {@code InetAddress} helpers.</b> {@code
 *     isSiteLocalAddress()} misses CGNAT (100.64/10) and IPv6 ULA (fc00::/7 —
 *     it only knows the deprecated fec0::/10), and nothing in the JDK covers
 *     240/4 or 192.0.0/24. An explicit table is auditable against a list of
 *     ranges; a pile of boolean helpers is not.</li>
 * <li><b>Embedded IPv4 is unwrapped.</b> {@code ::ffff:169.254.170.2}
 *     (IPv4-mapped), {@code 64:ff9b::a9fe:aa02} (NAT64) and {@code
 *     ::169.254.170.2} (IPv4-compatible) all name an IPv4 target inside a
 *     16-byte address. Range-check the outer address only and they sail
 *     through.</li>
 * </ul>
 *
 * <p>This is one of two halves. The other is {@link OutboundLlmHttp}: a
 * validated URL means nothing if the client then follows a 302 to somewhere
 * else, so redirects are off. Both use {@code java.net.URI} — the same parser
 * the JDK HttpClient uses to build the request — so there is no gap between
 * the URL we inspect and the URL that gets fetched.
 *
 * <p>Residual risk, deliberately accepted for now: DNS rebinding. We resolve
 * here and the client resolves again when it connects, so a hostname that
 * answers public on the first lookup and internal on the second still gets
 * through. Closing it needs a check at connect time (a validating DNS resolver
 * or an egress proxy), which the JDK HttpClient gives no hook for. Validating
 * immediately before each call — not just at credential-create time — keeps
 * the window small and covers credentials stored before this existed.
 */
public final class EgressUrlPolicy {

    private EgressUrlPolicy() {}

    /** IPv4 ranges that are not publicly routable, or are routable only inside our own network. */
    private static final List<Cidr> BLOCKED_V4 = List.of(
            Cidr.of("0.0.0.0", 8),         // "this host on this network"
            Cidr.of("10.0.0.0", 8),        // RFC1918
            Cidr.of("100.64.0.0", 10),     // CGNAT — used inside several clouds
            Cidr.of("127.0.0.0", 8),       // loopback
            Cidr.of("169.254.0.0", 16),    // link-local: EC2 IMDS + ECS task-role creds
            Cidr.of("172.16.0.0", 12),     // RFC1918
            Cidr.of("192.0.0.0", 24),      // IETF protocol assignments
            Cidr.of("192.168.0.0", 16),    // RFC1918
            Cidr.of("198.18.0.0", 15),     // benchmarking
            Cidr.of("224.0.0.0", 4),       // multicast
            Cidr.of("240.0.0.0", 4)        // reserved, incl. 255.255.255.255
    );

    private static final List<Cidr> BLOCKED_V6 = List.of(
            Cidr.of("::", 128),            // unspecified
            Cidr.of("::1", 128),           // loopback
            Cidr.of("fc00::", 7),          // unique local
            Cidr.of("fe80::", 10),         // link-local
            Cidr.of("ff00::", 8)           // multicast
    );

    /**
     * Validate a base URL the user supplied. No-op when blank: the built-in
     * providers carry their own compile-time base URL, and paying a DNS
     * round trip to re-check {@code api.openai.com} on every call buys
     * nothing and adds a failure mode.
     */
    public static void requirePublicOverride(String override) {
        if (override == null || override.isBlank()) return;
        requirePublicDestination(override);
    }

    /** Throws 400 unless {@code rawUrl} is http(s) and resolves entirely to public addresses. */
    public static void requirePublicDestination(String rawUrl) {
        URI uri;
        try {
            uri = new URI(rawUrl.trim());
        } catch (URISyntaxException | NullPointerException e) {
            throw reject("not a valid URL");
        }

        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            throw reject("must be http or https");
        }

        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            // Covers the malformed-authority cases too, e.g. underscores or a
            // bare IPv6 literal without brackets, which URI won't parse a host
            // out of. Better to refuse than to guess.
            throw reject("no host in URL");
        }

        InetAddress[] resolved;
        try {
            resolved = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw reject("host does not resolve");
        }
        if (resolved.length == 0) throw reject("host does not resolve");

        for (InetAddress addr : resolved) {
            if (isBlocked(addr)) {
                // Deliberately does not echo which address it resolved to —
                // that turns the error into an internal-network oracle.
                throw reject("host resolves to a non-public address");
            }
        }
    }

    /** Visible for testing. */
    static boolean isBlocked(InetAddress addr) {
        byte[] bytes = addr.getAddress();

        if (bytes.length == 16) {
            byte[] embedded = embeddedIpv4(bytes);
            if (embedded != null) {
                try {
                    return isBlocked(InetAddress.getByAddress(embedded));
                } catch (UnknownHostException e) {
                    return true; // 4 bytes is always valid; unreachable, but fail closed
                }
            }
            for (Cidr c : BLOCKED_V6) if (c.contains(bytes)) return true;
            return false;
        }

        for (Cidr c : BLOCKED_V4) if (c.contains(bytes)) return true;
        return false;
    }

    /**
     * The IPv4 address hiding inside a 16-byte address, or null if there
     * isn't one: {@code ::ffff:a.b.c.d} (mapped), {@code 64:ff9b::a.b.c.d}
     * (NAT64), {@code ::a.b.c.d} (compatible, deprecated but still parses).
     */
    private static byte[] embeddedIpv4(byte[] b) {
        boolean mapped = true;
        for (int i = 0; i < 10; i++) if (b[i] != 0) { mapped = false; break; }
        if (mapped && (b[10] & 0xFF) == 0xFF && (b[11] & 0xFF) == 0xFF) {
            return new byte[]{b[12], b[13], b[14], b[15]};
        }
        // ::a.b.c.d — all-zero prefix with a non-zero tail.
        if (mapped && b[10] == 0 && b[11] == 0
                && !(b[12] == 0 && b[13] == 0 && b[14] == 0 && b[15] == 0)) {
            return new byte[]{b[12], b[13], b[14], b[15]};
        }
        // 64:ff9b::/96
        if ((b[0] & 0xFF) == 0x00 && (b[1] & 0xFF) == 0x64
                && (b[2] & 0xFF) == 0xFF && (b[3] & 0xFF) == 0x9B) {
            boolean rest = true;
            for (int i = 4; i < 12; i++) if (b[i] != 0) { rest = false; break; }
            if (rest) return new byte[]{b[12], b[13], b[14], b[15]};
        }
        return null;
    }

    private static ResponseStatusException reject(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "base URL rejected: " + reason);
    }

    /** An address range, compared bit-prefix-wise. */
    private record Cidr(byte[] network, int prefixBits) {
        static Cidr of(String literal, int prefixBits) {
            try {
                // An IP literal, so this never touches DNS.
                return new Cidr(InetAddress.getByName(literal).getAddress(), prefixBits);
            } catch (UnknownHostException e) {
                throw new IllegalStateException("bad CIDR literal: " + literal, e);
            }
        }

        boolean contains(byte[] addr) {
            if (addr.length != network.length) return false;
            int fullBytes = prefixBits / 8;
            for (int i = 0; i < fullBytes; i++) {
                if (addr[i] != network[i]) return false;
            }
            int remainingBits = prefixBits % 8;
            if (remainingBits == 0) return true;
            int mask = 0xFF << (8 - remainingBits);
            return (addr[fullBytes] & mask) == (network[fullBytes] & mask);
        }
    }
}

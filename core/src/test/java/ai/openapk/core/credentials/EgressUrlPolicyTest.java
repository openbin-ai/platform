package ai.openapk.core.credentials;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Every case uses an IP literal or a name that resolves without leaving the
 * machine ({@code localhost}), so the suite needs no network and can't flake
 * on DNS.
 */
class EgressUrlPolicyTest {

    private static void rejected(String url) {
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> EgressUrlPolicy.requirePublicDestination(url),
                () -> "should have been rejected: " + url);
        assertEquals(400, e.getStatusCode().value());
    }

    private static void allowed(String url) {
        assertDoesNotThrow(() -> EgressUrlPolicy.requirePublicDestination(url),
                () -> "should have been allowed: " + url);
    }

    @Test
    void allowsOrdinaryPublicEndpoints() {
        allowed("https://1.1.1.1/v1");
        allowed("http://8.8.8.8:8080/v1");
        allowed("https://[2606:4700:4700::1111]/v1");
        allowed("https://1.1.1.1/v1/");            // trailing slash, as stored
        allowed("  https://1.1.1.1/v1  ");         // pasted with whitespace
    }

    @Test
    void rejectsLoopbackAndUnspecified() {
        rejected("http://127.0.0.1:11434/v1");     // a local Ollama is not reachable from prod anyway
        rejected("http://127.1.2.3/v1");
        rejected("http://[::1]:8080/v1");
        rejected("http://0.0.0.0/v1");
        rejected("http://localhost:8080/v1");
    }

    @Test
    void rejectsCloudMetadataAndLinkLocal() {
        rejected("http://169.254.169.254/latest/meta-data/");       // EC2 IMDS
        rejected("http://169.254.170.2/v2/credentials/");           // ECS task-role creds
        rejected("http://[fe80::1]/v1");
    }

    @Test
    void rejectsPrivateAndCarrierGradeRanges() {
        rejected("http://10.0.0.1/v1");
        rejected("http://172.16.5.5/v1");
        rejected("http://172.31.255.254/v1");
        rejected("http://192.168.1.1/v1");
        rejected("http://100.64.0.1/v1");          // CGNAT — isSiteLocalAddress misses this
        rejected("http://192.0.0.1/v1");
        rejected("http://198.18.0.1/v1");
    }

    @Test
    void rejectsMulticastAndReserved() {
        rejected("http://224.0.0.1/v1");
        rejected("http://239.255.255.250/v1");
        rejected("http://240.0.0.1/v1");
        rejected("http://255.255.255.255/v1");
        rejected("http://[ff02::1]/v1");
    }

    @Test
    void rejectsIpv6UniqueLocal() {
        rejected("http://[fc00::1]/v1");
        rejected("http://[fd12:3456:789a::1]/v1"); // fd00::/8 is inside fc00::/7
    }

    @Test
    void rejectsIpv4HiddenInsideAnIpv6Address() {
        // Range-check the 16-byte address alone and every one of these reads as
        // an ordinary global-unicast v6 address.
        rejected("http://[::ffff:169.254.170.2]/v1");   // IPv4-mapped
        rejected("http://[64:ff9b::a9fe:aa02]/v1");     // NAT64 of 169.254.170.2
        rejected("http://[64:ff9b::7f00:1]/v1");        // NAT64 of 127.0.0.1
        rejected("http://[::a9fe:aa02]/v1");            // IPv4-compatible
    }

    @Test
    void rejectsNonHttpSchemes() {
        rejected("file:///etc/passwd");
        rejected("gopher://1.1.1.1/");
        rejected("ftp://1.1.1.1/");
        rejected("//1.1.1.1/v1");                  // scheme-relative
        rejected("1.1.1.1/v1");                    // no scheme at all
    }

    @Test
    void rejectsMalformedAndHostlessUrls() {
        rejected("http:///v1");
        rejected("https://");
        rejected("not a url at all");
        rejected("http://[not-an-ipv6]/v1");
    }

    @Test
    void credentialsWithUserInfoAreJudgedOnTheRealHost() {
        // http://legit.example@169.254.170.2/ — the authority's userinfo is a
        // classic way to make a URL LOOK like it points somewhere public.
        rejected("http://api.openai.com@169.254.170.2/v1");
        rejected("http://api.openai.com:password@10.0.0.1/v1");
    }

    @Test
    void aBlankOverrideIsNotChecked() {
        // Built-in providers carry their own base URL; only user-supplied
        // overrides are validated, so a blank one must be a no-op rather than
        // a 400 on every call.
        assertDoesNotThrow(() -> EgressUrlPolicy.requirePublicOverride(null));
        assertDoesNotThrow(() -> EgressUrlPolicy.requirePublicOverride(""));
        assertDoesNotThrow(() -> EgressUrlPolicy.requirePublicOverride("   "));
    }

    @Test
    void anOverrideThatIsSetIsChecked() {
        assertThrows(ResponseStatusException.class,
                () -> EgressUrlPolicy.requirePublicOverride("http://169.254.169.254/"));
    }
}

package ai.openapk.core.credentials;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Do the outbound LLM clients follow HTTP redirects?
 *
 * <p>This decides whether validating the user-supplied base URL is worth
 * anything. If a client follows redirects, an attacker points {@code baseUrl}
 * at a public host they control, that host answers 302
 * {@code Location: http://169.254.170.2/...}, and the validated-as-public URL
 * lands on the internal target anyway — the validator inspects the URL it was
 * handed, never the one actually fetched.
 *
 * <p>This started as four transports with three different defaults, and two of
 * them followed redirects: {@code RestClient.builder().build()} (the credential
 * tester) resolved to Apache HttpClient5, and {@code SimpleClientHttpRequestFactory}
 * (model catalog, chat completions) follows on GET but not POST. Both GETs were
 * therefore bypassable. Everything now routes through
 * {@link OutboundLlmHttp}; these tests exist so a future transport swap can't
 * quietly reintroduce a follow.
 */
class OutboundRedirectPolicyTest {

    private HttpServer server;
    private String base;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        // Stands in for the attacker-controlled public host named in baseUrl.
        server.createContext("/redirect", ex -> {
            ex.getResponseHeaders().add("Location", "/internal");
            // 307 preserves the method, so it works for the POST path too.
            ex.sendResponseHeaders("POST".equals(ex.getRequestMethod()) ? 307 : 302, -1);
            ex.close();
        });
        // Stands in for the internal-only target (metadata service, Keycloak…).
        server.createContext("/internal", ex -> {
            byte[] body = "INTERNAL-SECRET".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, body.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void getMustNotFollowRedirects() {
        // Covers LlmCredentialTester and LlmModelCatalog (both GET /models).
        // A redirect is surfaced as an error, not silently followed and not
        // silently empty.
        assertThrows(Exception.class,
                () -> egressClient().get().uri(base + "/redirect").retrieve().body(String.class),
                "GET followed a redirect or swallowed it — base-URL SSRF check bypassable via 302");
    }

    @Test
    void postMustNotFollowRedirects() {
        // Covers LlmInvoker's chat completions.
        assertThrows(Exception.class,
                () -> egressClient().post().uri(base + "/redirect")
                        .header("content-type", "application/json")
                        .body("{}")
                        .retrieve().body(String.class),
                "POST followed a redirect — base-URL SSRF check bypassable via 307");
    }

    @Test
    void aRedirectNeverReachesTheRedirectTarget() {
        // The point of the two tests above, stated directly: whatever happens,
        // the body of the internal target must never come back.
        String body;
        try {
            body = egressClient().get().uri(base + "/redirect").retrieve().body(String.class);
        } catch (Exception e) {
            body = null;
        }
        assertNotEquals("INTERNAL-SECRET", body, "the redirect target's body was returned to the caller");
    }

    @Test
    void streamingClientMustNotFollowRedirects() throws Exception {
        HttpClient client = OutboundLlmHttp.streamingClient(Duration.ofSeconds(15));
        HttpResponse<String> resp = client.send(
                HttpRequest.newBuilder(URI.create(base + "/redirect")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(302, resp.statusCode(),
                "StreamingLlmInvoker's client follows redirects — SSRF check bypassable via 302");
    }

    /** The one client every BYOK LLM call is supposed to go through. */
    private static RestClient egressClient() {
        return OutboundLlmHttp.restClient(Duration.ofSeconds(10), Duration.ofSeconds(20));
    }
}

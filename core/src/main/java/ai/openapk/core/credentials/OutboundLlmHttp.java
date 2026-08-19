package ai.openapk.core.credentials;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;

/**
 * The one way to build an HTTP client for BYOK LLM egress.
 *
 * <p>These requests go to a URL the USER chose (the OPENAI_COMPAT provider's
 * {@code baseUrl}) from inside our VPC, which makes them the app's SSRF
 * surface. {@link LlmBaseUrlValidator} rejects base URLs that resolve to
 * non-public addresses — but that check is worthless if the client then
 * follows a redirect, because the hop it follows is never validated: point
 * {@code baseUrl} at a public host you control, answer 302
 * {@code Location: http://169.254.170.2/…}, and the request lands on the
 * internal target anyway.
 *
 * <p>That was not hypothetical. The three call sites had three different
 * transports with three different defaults, and two of them followed
 * redirects: {@code RestClient.builder().build()} resolves to Apache
 * HttpClient5 (follows), and {@code SimpleClientHttpRequestFactory} sets
 * {@code setInstanceFollowRedirects(!"POST".equals(method))} — so GET /models
 * followed while POST /chat/completions didn't. See OutboundRedirectPolicyTest.
 *
 * <p>So: one factory, redirects off, and a 3xx turned into a clear error
 * instead of an empty body. HTTP/1.1 is pinned to match what
 * HttpURLConnection and Apache were negotiating before — self-hosted
 * OpenAI-compatible endpoints are exactly the population where an HTTP/2
 * upgrade attempt is most likely to misbehave, and this is a security fix,
 * not the place to change wire behaviour.
 */
public final class OutboundLlmHttp {

    private OutboundLlmHttp() {}

    public static RestClient restClient(Duration connectTimeout, Duration readTimeout) {
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(connectTimeout)
                .build();
        var factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(readTimeout);
        return RestClient.builder()
                .requestFactory(factory)
                .defaultStatusHandler(HttpStatusCode::is3xxRedirection, (req, res) -> {
                    throw new IOException("base URL responded with a redirect ("
                            + res.getStatusCode().value() + " to "
                            + res.getHeaders().getFirst("Location")
                            + "); redirects are not followed on LLM endpoints");
                })
                .build();
    }

    /**
     * Streaming needs the raw JDK client (RestClient buffers the body, which
     * would defeat SSE), so it gets the same policy from the same place.
     */
    public static HttpClient streamingClient(Duration connectTimeout) {
        return HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(connectTimeout)
                .build();
    }
}

package ai.openapk.core.credentials;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LlmEndpointsTest {

    @Test
    void defaultsToTheRealApiWhenNoOverride() {
        var p = new LlmCredentialPayload.Anthropic("sk-ant-x", null);
        assertEquals("https://api.anthropic.com/v1/messages", LlmEndpoints.anthropicMessagesUrl(p));
        assertEquals("https://api.anthropic.com/v1/models", LlmEndpoints.anthropicModelsUrl(p));
        var blank = new LlmCredentialPayload.Anthropic("sk-ant-x", "   ");
        assertEquals("https://api.anthropic.com/v1/messages", LlmEndpoints.anthropicMessagesUrl(blank));
    }

    @Test
    void routesThroughAPublicGateway() {
        // IP literal so the egress check needs no DNS.
        var p = new LlmCredentialPayload.Anthropic("sk-ant-x", "https://1.1.1.1/");
        assertEquals("https://1.1.1.1/v1/messages", LlmEndpoints.anthropicMessagesUrl(p));
        assertEquals("https://1.1.1.1/v1/models", LlmEndpoints.anthropicModelsUrl(p));
    }

    @Test
    void refusesAnInternalGatewayOnEveryCall() {
        var p = new LlmCredentialPayload.Anthropic("sk-ant-x", "http://169.254.169.254");
        var e = assertThrows(ResponseStatusException.class, () -> LlmEndpoints.anthropicMessagesUrl(p));
        assertEquals(400, e.getStatusCode().value());
        assertThrows(ResponseStatusException.class, () -> LlmEndpoints.anthropicModelsUrl(p));
    }
}

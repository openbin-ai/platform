package ai.openapk.core.ctf;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * Posts to a Discord webhook. Off when {@code openapk.discord.webhook-url}
 * is blank, which is the dev default. Fire-and-forget: a Discord outage
 * must never fail a flag submission.
 */
@Component
public class DiscordNotifier {

    private static final Logger log = LoggerFactory.getLogger(DiscordNotifier.class);

    private final String webhookUrl;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public DiscordNotifier(@Value("${openapk.discord.webhook-url:}") String webhookUrl, ObjectMapper mapper) {
        this.webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
        this.mapper = mapper;
        log.info("Discord notifier {}", this.webhookUrl.isEmpty() ? "disabled (no webhook configured)" : "enabled");
    }

    public boolean enabled() {
        return !webhookUrl.isEmpty();
    }

    @Async
    public void post(String content) {
        if (!enabled()) return;
        try {
            byte[] body = mapper.writeValueAsBytes(Map.of("content", content));
            var req = HttpRequest.newBuilder(URI.create(webhookUrl))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) {
                log.warn("Discord webhook returned {}: {}", resp.statusCode(), resp.body());
            }
        } catch (Exception e) {
            log.warn("Discord webhook failed: {}", e.toString());
        }
    }
}

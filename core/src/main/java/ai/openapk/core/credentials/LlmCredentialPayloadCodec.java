package ai.openapk.core.credentials;

import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class LlmCredentialPayloadCodec {

    private final ObjectMapper mapper;

    public LlmCredentialPayloadCodec(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public byte[] toJson(LlmCredentialPayload payload) {
        return mapper.writeValueAsBytes(payload);
    }

    public LlmCredentialPayload fromJson(byte[] bytes, LlmProvider provider) {
        // Keyed on the wire-protocol kind so every OpenAI-compatible provider
        // (OpenAI, Gemini, DeepSeek, Qwen, Kimi, generic) shares one payload
        // shape and a new one needs no change here.
        Class<? extends LlmCredentialPayload> type = switch (provider.kind()) {
            case ANTHROPIC -> LlmCredentialPayload.Anthropic.class;
            case OPENAI -> LlmCredentialPayload.OpenAI.class;
            case BEDROCK -> LlmCredentialPayload.Bedrock.class;
        };
        return mapper.readValue(bytes, type);
    }
}

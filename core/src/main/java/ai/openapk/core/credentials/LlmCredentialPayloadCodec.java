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
        Class<? extends LlmCredentialPayload> type = switch (provider) {
            case ANTHROPIC -> LlmCredentialPayload.Anthropic.class;
            case OPENAI -> LlmCredentialPayload.OpenAI.class;
            case BEDROCK -> LlmCredentialPayload.Bedrock.class;
        };
        return mapper.readValue(bytes, type);
    }
}

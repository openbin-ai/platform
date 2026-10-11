package ai.openapk.core.credentials;

/**
 * URL builders for the Anthropic wire format. Every Anthropic call path
 * (completion, streaming, key test, model list) builds its URI here so the
 * per-credential gateway override and the egress policy on it cannot be
 * forgotten on one of them. The OpenAI-compatible equivalent lives in
 * {@code LlmInvoker.openAiChatUrl}.
 */
public final class LlmEndpoints {

    private LlmEndpoints() {}

    /** {@code <base>/v1/messages}, with {@code base} from the credential or the enum. */
    public static String anthropicMessagesUrl(LlmCredentialPayload.Anthropic p) {
        return anthropicBase(p) + "/v1/messages";
    }

    /** {@code <base>/v1/models}. */
    public static String anthropicModelsUrl(LlmCredentialPayload.Anthropic p) {
        return anthropicBase(p) + "/v1/models";
    }

    private static String anthropicBase(LlmCredentialPayload.Anthropic p) {
        // Re-checked on every call, not only at credential-create time: DNS
        // for a user-supplied host can change under us, and credentials
        // stored before the check existed still go through it.
        EgressUrlPolicy.requirePublicOverride(p.baseUrl());
        return LlmProvider.ANTHROPIC.resolveBaseUrl(p.baseUrl()).replaceAll("/+$", "");
    }
}

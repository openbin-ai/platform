package ai.openapk.core.credentials;

/**
 * A BYOK LLM provider. Most providers speak the OpenAI wire protocol (Chat
 * Completions + {@code /models}); those share the {@link Kind#OPENAI} code path
 * and differ only by {@link #baseUrl()}, so adding a new OpenAI-compatible
 * provider is a one-line enum entry — no changes to the invoke/stream/test
 * paths, which switch on {@link #kind()} rather than the provider itself.
 *
 * <p>{@link #OPENAI_COMPAT} is the generic escape hatch: the user supplies the
 * base URL at credential-create time, so a brand-new compatible provider needs
 * no code change at all.
 *
 * <p>{@code baseUrl} is the API root the OpenAI-compatible endpoints hang off
 * ({@code $baseUrl/chat/completions}, {@code $baseUrl/models}); null for
 * {@link #OPENAI_COMPAT} (per-credential) and {@link #BEDROCK} (SDK, not HTTP).
 * {@code defaultModel} is the fallback when the caller doesn't pick one; null
 * means "the caller must specify a model" (generic compat — we can't guess).
 */
public enum LlmProvider {

    ANTHROPIC("anthropic", Kind.ANTHROPIC, "https://api.anthropic.com", "claude-sonnet-4-6"),
    OPENAI("openai", Kind.OPENAI, "https://api.openai.com/v1", "gpt-5.1"),
    BEDROCK("bedrock", Kind.BEDROCK, null, "anthropic.claude-3-5-sonnet-20241022-v2:0"),

    // OpenAI-compatible providers — same wire format as OPENAI, different host.
    GEMINI("gemini", Kind.OPENAI, "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    DEEPSEEK("deepseek", Kind.OPENAI, "https://api.deepseek.com/v1", "deepseek-chat"),
    QWEN("qwen", Kind.OPENAI, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    KIMI("kimi", Kind.OPENAI, "https://api.moonshot.ai/v1", "kimi-k3"),

    // Generic escape hatch — the user supplies the base URL + a model.
    OPENAI_COMPAT("openai_compat", Kind.OPENAI, null, null);

    /** Wire protocol family — the switch key for invoke/stream/test. */
    public enum Kind { ANTHROPIC, OPENAI, BEDROCK }

    private final String dbValue;
    private final Kind kind;
    private final String baseUrl;
    private final String defaultModel;

    LlmProvider(String dbValue, Kind kind, String baseUrl, String defaultModel) {
        this.dbValue = dbValue;
        this.kind = kind;
        this.baseUrl = baseUrl;
        this.defaultModel = defaultModel;
    }

    public String dbValue() {
        return dbValue;
    }

    public Kind kind() {
        return kind;
    }

    /** Default API root; may be null (OPENAI_COMPAT supplies its own; BEDROCK is SDK). */
    public String baseUrl() {
        return baseUrl;
    }

    /** Fallback model when the caller doesn't specify one; null = must specify. */
    public String defaultModel() {
        return defaultModel;
    }

    /**
     * Effective OpenAI-compatible API root: the per-credential override when set
     * (OPENAI_COMPAT), else the enum default. Callers append
     * {@code /chat/completions} or {@code /models}.
     */
    public String resolveBaseUrl(String override) {
        if (override != null && !override.isBlank()) return override;
        return baseUrl;
    }

    public static LlmProvider fromDb(String s) {
        for (var p : values()) {
            if (p.dbValue.equals(s)) return p;
        }
        throw new IllegalArgumentException("unknown provider: " + s);
    }
}

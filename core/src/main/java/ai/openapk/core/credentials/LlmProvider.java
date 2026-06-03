package ai.openapk.core.credentials;

public enum LlmProvider {

    ANTHROPIC("anthropic"),
    OPENAI("openai"),
    BEDROCK("bedrock");

    private final String dbValue;

    LlmProvider(String dbValue) {
        this.dbValue = dbValue;
    }

    public String dbValue() {
        return dbValue;
    }

    public static LlmProvider fromDb(String s) {
        for (var p : values()) {
            if (p.dbValue.equals(s)) return p;
        }
        throw new IllegalArgumentException("unknown provider: " + s);
    }
}

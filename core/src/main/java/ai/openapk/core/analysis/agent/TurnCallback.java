package ai.openapk.core.analysis.agent;

/** Live events during a streamed turn. Both are invoked on the calling thread. */
public interface TurnCallback {

    /** A fragment of assistant text, in order. */
    void onText(String delta);

    /** The model has started a tool call; its input is not known yet. */
    void onToolUseStart(String id, String name);
}

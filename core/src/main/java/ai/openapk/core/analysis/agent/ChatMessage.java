package ai.openapk.core.analysis.agent;

import java.util.List;

/** One turn of the conversation. Tool results travel in a USER message, as on the Anthropic wire. */
public record ChatMessage(Role role, List<ContentBlock> blocks) {

    public enum Role { USER, ASSISTANT }

    public ChatMessage {
        blocks = List.copyOf(blocks);
    }

    public static ChatMessage user(String text) {
        return new ChatMessage(Role.USER, List.of(new ContentBlock.Text(text)));
    }

    public static ChatMessage assistant(List<ContentBlock> blocks) {
        return new ChatMessage(Role.ASSISTANT, blocks);
    }

    public static ChatMessage toolResults(List<ContentBlock.ToolResult> results) {
        return new ChatMessage(Role.USER, List.copyOf(results));
    }
}

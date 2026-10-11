package ai.openapk.core.analysis.agent;

import java.util.List;

/**
 * The assistant's complete output for one turn. {@code blocks} is verbatim
 * (text + tool_use, in order) so the caller can append it to history as an
 * assistant message unchanged before returning tool results.
 */
public record TurnResult(StopReason stopReason, List<ContentBlock> blocks, int inputTokens, int outputTokens, String model) {

    public TurnResult {
        blocks = List.copyOf(blocks);
    }

    /** All text blocks concatenated. */
    public String text() {
        StringBuilder sb = new StringBuilder();
        for (ContentBlock b : blocks) {
            if (b instanceof ContentBlock.Text t) sb.append(t.text());
        }
        return sb.toString();
    }

    public List<ContentBlock.ToolUse> toolUses() {
        return blocks.stream()
                .filter(ContentBlock.ToolUse.class::isInstance)
                .map(ContentBlock.ToolUse.class::cast)
                .toList();
    }

    public ChatMessage asMessage() {
        return ChatMessage.assistant(blocks);
    }
}

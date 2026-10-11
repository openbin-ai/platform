package ai.openapk.core.analysis.agent;

import tools.jackson.databind.JsonNode;

/**
 * One content block in the provider-agnostic message model. The agent loop
 * speaks only this union; each wire adapter in {@link ToolLlmInvoker}
 * translates it to its own schema, so adding a provider never touches the loop.
 */
public sealed interface ContentBlock {

    /** Plain text, from either side. */
    record Text(String text) implements ContentBlock {}

    /**
     * The assistant asking for a tool call. {@code id} is provider-assigned and
     * must be echoed back in the matching {@link ToolResult}; {@code input} is
     * the parsed arguments object (never null, possibly empty).
     */
    record ToolUse(String id, String name, JsonNode input) implements ContentBlock {}

    /** The caller returning a tool's output for the {@link ToolUse} with {@code toolUseId}. */
    record ToolResult(String toolUseId, String content, boolean isError) implements ContentBlock {}
}

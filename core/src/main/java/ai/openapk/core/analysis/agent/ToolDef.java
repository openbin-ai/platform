package ai.openapk.core.analysis.agent;

import tools.jackson.databind.JsonNode;

/** A tool the model may call. {@code inputSchema} is a JSON Schema object node. */
public record ToolDef(String name, String description, JsonNode inputSchema) {}

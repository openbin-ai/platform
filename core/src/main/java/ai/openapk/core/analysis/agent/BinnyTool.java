package ai.openapk.core.analysis.agent;

import tools.jackson.databind.JsonNode;

/**
 * One tool BINNY light can call. {@link #run} returns what the model reads
 * back (plain text, bounded by the toolkit) and, for write tools, the
 * artifact it created so the UI can link to it.
 */
public interface BinnyTool {

    ToolDef def();

    /** True for tools that change the project; only offered to editors. */
    boolean writes();

    Outcome run(BinnyToolContext ctx, JsonNode input);

    /**
     * @param text     what the model sees
     * @param summary  one line for the UI's tool card
     * @param artifact created thing, or null (kind: highlight | report_section | script)
     */
    record Outcome(String text, String summary, Artifact artifact) {
        public static Outcome of(String text, String summary) {
            return new Outcome(text, summary, null);
        }
    }

    record Artifact(String kind, String id, String label) {}
}

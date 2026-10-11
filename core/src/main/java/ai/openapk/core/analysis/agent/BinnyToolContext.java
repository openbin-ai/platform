package ai.openapk.core.analysis.agent;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.ProjectKind;
import tools.jackson.databind.JsonNode;

import java.util.UUID;
import java.util.function.Supplier;

/**
 * Everything a tool needs to run one call on behalf of one request. The
 * binary analysis JSON is loaded lazily and cached for the request: it can
 * be megabytes, and a turn with no BIN tool calls should not pay for it.
 *
 * @param canEdit    caller is OWNER or EDITOR; write tools are only offered
 *                   (and only succeed) when true
 * @param unitRef    what the user is looking at: a function name (BIN) or a
 *                   file path (APK / SCRIPT). Tools default to it.
 * @param inlineFile SCRIPT projects only: the file body the browser sent,
 *                   since script bundles are not readable server-side
 */
public record BinnyToolContext(
        User user,
        UUID projectId,
        ProjectKind kind,
        boolean canEdit,
        String unitRef,
        String inlineFile,
        Supplier<JsonNode> analysis
) {}

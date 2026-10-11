package ai.openapk.core.analysis.agent;

/** Why the turn ended, normalized across providers. */
public enum StopReason { END_TURN, TOOL_USE, MAX_TOKENS, OTHER }

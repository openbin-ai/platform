package ai.openapk.core.dm;

/** Who may open a DM with a user. Stored as text on {@code users.dm_policy}. */
public enum DmPolicy {
    /** Any signed-in researcher. */
    EVERYONE,
    /** Only people the user follows — their explicit allowlist. */
    FOLLOWING,
    /** DMs off. Existing threads become read-only for the other side. */
    NOBODY;

    public static DmPolicy of(String s) {
        if (s == null) return EVERYONE;
        try {
            return valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return EVERYONE;
        }
    }
}

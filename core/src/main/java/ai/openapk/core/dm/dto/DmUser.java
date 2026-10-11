package ai.openapk.core.dm.dto;

import java.util.UUID;

/** The other party as the inbox / thread renders them: avatar + label. */
public record DmUser(UUID userId, String displayName, String emailMd5) {}

package ai.openapk.core.crypto.dto;

/** A single crypto-API hit from the cached static digest. */
public record CryptoHit(
        String file,
        int line,
        String snippet
) {}

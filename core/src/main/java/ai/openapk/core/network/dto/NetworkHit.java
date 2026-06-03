package ai.openapk.core.network.dto;

/**
 * One detected HTTP/network call site. Coarse, regex-based — captures the
 * client library used, the HTTP method when known, and either a URL literal
 * or the variable expression passed where the URL would be.
 */
public record NetworkHit(
        String kind,        // "okhttp" | "retrofit" | "httpurlconnection" | "websocket"
        String httpMethod,  // "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "" if unknown
        String url,         // URL literal or expression (e.g. "https://x.com/api", "BASE_URL + path")
        String file,
        int line,
        String snippet
) {}

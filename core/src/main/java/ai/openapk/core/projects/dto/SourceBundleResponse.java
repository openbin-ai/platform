package ai.openapk.core.projects.dto;

import ai.openapk.core.projects.storage.ProjectStorage;

/**
 * Presigned download descriptor for a project's whole decompiled tree
 * (src.tar.gz). The frontend fetches this once per project open, downloads
 * the tarball straight from S3, extracts it in the browser, and serves file
 * reads + search locally. {@code compressedBytes} lets the client make a
 * cheap "too big for client-side?" call before downloading (it range-reads
 * the gzip ISIZE trailer for the exact uncompressed figure).
 */
public record SourceBundleResponse(String url, long compressedBytes, String etag) {

    public static SourceBundleResponse from(ProjectStorage.SrcBundle b) {
        return new SourceBundleResponse(b.url().toString(), b.compressedBytes(), b.etag());
    }
}

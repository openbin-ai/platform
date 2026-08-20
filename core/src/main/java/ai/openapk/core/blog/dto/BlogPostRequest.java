package ai.openapk.core.blog.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Create / update body. The client sends markdown text — typically the
 * contents of a .md or .txt file the author dropped into the editor, which is
 * the workflow people were faking with script uploads.
 */
public record BlogPostRequest(
        @NotBlank
        @Size(min = 1, max = 300)
        String title,

        @Size(max = 500)
        String summary,

        // 400k of markdown is a very long essay and still far under the 1MB
        // request cap. The bound exists so a runaway paste can't become a
        // multi-megabyte row that the feed then has to skip over.
        @NotBlank
        @Size(min = 1, max = 400_000)
        String bodyMd
) {}

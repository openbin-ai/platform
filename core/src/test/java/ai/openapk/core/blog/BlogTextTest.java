package ai.openapk.core.blog;

import ai.openapk.core.social.dto.UpdateProfileRequest;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The pure text handling behind slugs, feed cards and profile links. */
class BlogTextTest {

    @Test
    void slugsAreUrlSafe() {
        assertEquals("unpacking-a-loader", BlogService.slugify("Unpacking a Loader"));
        assertEquals("emotet-2026-what-changed", BlogService.slugify("Emotet 2026: what changed?"));
        assertEquals("c-c-over-dns", BlogService.slugify("  C&C over DNS  "));
    }

    @Test
    void accentsAreFoldedRatherThanDropped() {
        // "Análisis" must not become "an-lisis" or vanish entirely.
        assertEquals("analisis-de-malware", BlogService.slugify("Análisis de Malware"));
    }

    @Test
    void aTitleWithNoLatinCharactersStillGetsARoutableSlug() {
        // Non-Latin script slugifies to nothing; the post still needs a URL.
        String slug = BlogService.slugify("マルウェア解析");
        assertFalse(slug.isBlank());
        assertTrue(slug.startsWith("post-"), slug);
    }

    @Test
    void longTitlesAreTruncatedWithoutATrailingDash() {
        String slug = BlogService.slugify("a ".repeat(120));
        assertTrue(slug.length() <= 80, "was " + slug.length());
        assertFalse(slug.endsWith("-"), slug);
    }

    @Test
    void excerptStripsMarkdownNoise() {
        String body = """
                # Heading

                Some **bold** intro with a [link](https://example.com).

                ```java
                System.out.println("this should not appear");
                ```
                """;
        String excerpt = BlogService.excerpt(body);
        assertFalse(excerpt.contains("System.out"), excerpt);
        assertFalse(excerpt.contains("**"), excerpt);
        assertFalse(excerpt.contains("https://example.com"), excerpt);
        assertTrue(excerpt.contains("link"), excerpt);   // link TEXT is kept
        assertTrue(excerpt.contains("Heading"), excerpt);
    }

    @Test
    void excerptIsCapped() {
        String excerpt = BlogService.excerpt("word ".repeat(400));
        assertTrue(excerpt.length() <= 201, "was " + excerpt.length());
        assertTrue(excerpt.endsWith("…"));
    }

    @Test
    void readingTimeIsAtLeastOneMinute() {
        assertEquals(1, BlogService.readingMinutes(""));
        assertEquals(1, BlogService.readingMinutes("short post"));
        assertEquals(2, BlogService.readingMinutes("word ".repeat(300)));
    }

    @Test
    void profileUrlsMustBeHttp() {
        assertTrue(UpdateProfileRequest.isHttpUrl("https://example.com"));
        assertTrue(UpdateProfileRequest.isHttpUrl("http://example.com/path"));
        assertTrue(UpdateProfileRequest.isHttpUrl(null), "null means leave unchanged");
        assertTrue(UpdateProfileRequest.isHttpUrl(""), "blank means clear the field");

        // The reason the URL fields are validated at all: a stored value gets
        // rendered as an href, so a scheme-bearing string is an XSS vector.
        assertFalse(UpdateProfileRequest.isHttpUrl("javascript:alert(1)"));
        assertFalse(UpdateProfileRequest.isHttpUrl("data:text/html;base64,PHNjcmlwdD4="));
        assertFalse(UpdateProfileRequest.isHttpUrl("ftp://example.com"));
        assertFalse(UpdateProfileRequest.isHttpUrl("example.com"), "no scheme");
        assertFalse(UpdateProfileRequest.isHttpUrl("https://"), "no host");
    }

    @Test
    void handleValidationRejectsUrlsAndMarkup() {
        assertTrue(new UpdateProfileRequest(null, null, "octocat", null, null, null).isGithubUserValid());
        assertFalse(new UpdateProfileRequest(null, null, "https://github.com/octocat", null, null, null)
                .isGithubUserValid());
        assertFalse(new UpdateProfileRequest(null, null, "<script>", null, null, null).isGithubUserValid());
        assertTrue(new UpdateProfileRequest(null, null, null, "jack", null, null).isXUserValid());
        assertFalse(new UpdateProfileRequest(null, null, null, "jack@x.com", null, null).isXUserValid());
    }
}

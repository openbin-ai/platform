package ai.openapk.core.social.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Size;

/**
 * Self-service edit of the caller's public profile. Every field is optional;
 * a null field is left unchanged, a blank one clears it.
 *
 * <p>Handles ({@code githubUser}, {@code xUser}) are stored BARE — no @, no
 * URL — and the frontend builds the link. That is a safety property, not a
 * style preference: a stored handle can never carry its own scheme, so it
 * can't turn a rendered profile link into {@code javascript:} or point at an
 * unrelated host. The two free-form URL fields can't be constrained that way,
 * so they're checked for an http(s) scheme here instead.
 */
public record UpdateProfileRequest(
        @Size(max = 600) String bio,
        @Size(max = 300) String websiteUrl,
        @Size(max = 39) String githubUser,
        @Size(max = 15) String xUser,
        @Size(max = 300) String mastodonUrl,
        @Size(max = 300) String linkedinUrl
) {

    private static final java.util.regex.Pattern HANDLE =
            java.util.regex.Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]*$");

    @AssertTrue(message = "GitHub username may contain only letters, digits, dot, dash and underscore")
    public boolean isGithubUserValid() {
        return isBlank(githubUser) || HANDLE.matcher(githubUser.strip()).matches();
    }

    @AssertTrue(message = "X handle may contain only letters, digits and underscore")
    public boolean isXUserValid() {
        return isBlank(xUser) || xUser.strip().matches("^[A-Za-z0-9_]+$");
    }

    @AssertTrue(message = "website must be an http(s) URL")
    public boolean isWebsiteUrlValid() {
        return isHttpUrl(websiteUrl);
    }

    @AssertTrue(message = "Mastodon link must be an http(s) URL")
    public boolean isMastodonUrlValid() {
        return isHttpUrl(mastodonUrl);
    }

    @AssertTrue(message = "LinkedIn link must be an http(s) URL")
    public boolean isLinkedinUrlValid() {
        return isHttpUrl(linkedinUrl);
    }

    /** Visible for testing. Blank is allowed — it means "clear this field". */
    public static boolean isHttpUrl(String value) {
        if (isBlank(value)) return true;
        String v = value.strip();
        try {
            var uri = new java.net.URI(v);
            String scheme = uri.getScheme();
            return scheme != null
                    && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                    && uri.getHost() != null && !uri.getHost().isBlank();
        } catch (java.net.URISyntaxException e) {
            return false;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}

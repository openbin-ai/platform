package ai.openapk.core.tos;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.config.OpenApkProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Thin façade for TOS acceptance state. Centralizes the version-compare
 * logic so both the read endpoint and the enforcement filter use the same
 * "accepted?" rule.
 */
@Service
public class TosService {

    private final OpenApkProperties props;
    private final UserRepository users;

    public TosService(OpenApkProperties props, UserRepository users) {
        this.props = props;
        this.users = users;
    }

    /**
     * The version string the platform currently considers binding.
     * Configured in {@code application.yml} under {@code openapk.tos.current-version};
     * defaults to "unset" so misconfiguration loudly trips rather than
     * silently allowing all users through.
     */
    public String currentVersion() {
        var t = props.tos();
        if (t == null || t.currentVersion() == null || t.currentVersion().isBlank()) {
            return "unset";
        }
        return t.currentVersion();
    }

    public boolean hasAccepted(User u) {
        if (u == null || u.getTosAcceptedVersion() == null) return false;
        return u.getTosAcceptedVersion().equals(currentVersion());
    }

    @Transactional
    public AcceptanceState accept(User u) {
        u.setTosAcceptedVersion(currentVersion());
        u.setTosAcceptedAt(Instant.now());
        users.save(u);
        return new AcceptanceState(currentVersion(), u.getTosAcceptedVersion(), u.getTosAcceptedAt());
    }

    public AcceptanceState state(User u) {
        return new AcceptanceState(currentVersion(),
                u != null ? u.getTosAcceptedVersion() : null,
                u != null ? u.getTosAcceptedAt() : null);
    }

    public record AcceptanceState(
            String currentVersion,
            String acceptedVersion,
            Instant acceptedAt
    ) {
        public boolean accepted() {
            return acceptedVersion != null && acceptedVersion.equals(currentVersion);
        }
    }
}

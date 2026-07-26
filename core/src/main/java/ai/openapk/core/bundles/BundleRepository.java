package ai.openapk.core.bundles;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BundleRepository extends JpaRepository<Bundle, UUID> {

    /** Owner's bundles, newest first — the dashboard grouping query. */
    List<Bundle> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * Owner-scoped fetch — returns empty (→ 404) rather than another owner's
     * bundle, so bundle ids can't be probed across accounts.
     */
    Optional<Bundle> findByIdAndUserId(UUID id, UUID userId);

    /** Get-or-create-by-name support: first existing bundle with this exact name. */
    Optional<Bundle> findFirstByUserIdAndNameOrderByCreatedAtAsc(UUID userId, String name);
}

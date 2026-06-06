package ai.openapk.core.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByKeycloakSub(String sub);

    /**
     * Lookup by email — used by the project share modal so the owner can
     * invite a collaborator by typing their email rather than a UUID.
     * Case-insensitive (Postgres stores emails as-is; Spring Data's
     * derived query uses LOWER on both sides via IgnoreCase).
     */
    Optional<User> findByEmailIgnoreCase(String email);

    /**
     * Race-safe JIT provisioning. Concurrent first-load requests for the same
     * user used to both check-then-insert and the second one died on the
     * unique-key constraint, aborting the surrounding transaction. ON CONFLICT
     * DO NOTHING makes the insert a no-op when another caller already won —
     * no exception, the surrounding tx stays clean, the follow-up findBy
     * always returns the row.
     */
    @Modifying
    @Query(value = """
            INSERT INTO users (id, keycloak_sub, email, display_name, created_at, last_seen_at)
            VALUES (:id, :sub, :email, :name, NOW(), NOW())
            ON CONFLICT (keycloak_sub) DO NOTHING
            """, nativeQuery = true)
    int insertIfNotExists(
            @Param("id") UUID id,
            @Param("sub") String sub,
            @Param("email") String email,
            @Param("name") String name);
}

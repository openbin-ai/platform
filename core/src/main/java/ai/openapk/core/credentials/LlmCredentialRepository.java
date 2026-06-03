package ai.openapk.core.credentials;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LlmCredentialRepository extends JpaRepository<LlmCredential, UUID> {

    List<LlmCredential> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<LlmCredential> findByIdAndUserId(UUID id, UUID userId);

    boolean existsByUserIdAndLabel(UUID userId, String label);
}

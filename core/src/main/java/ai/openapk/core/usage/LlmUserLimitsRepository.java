package ai.openapk.core.usage;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface LlmUserLimitsRepository extends JpaRepository<LlmUserLimits, UUID> {

    Optional<LlmUserLimits> findByUserId(UUID userId);
}

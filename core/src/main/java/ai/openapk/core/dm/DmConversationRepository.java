package ai.openapk.core.dm;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DmConversationRepository extends JpaRepository<DmConversation, UUID> {
    Optional<DmConversation> findByPairKey(String pairKey);

    Optional<DmConversation> findByProjectId(UUID projectId);
}

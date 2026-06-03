package ai.openapk.core.deobf;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FunctionDeobfuscationRepository extends JpaRepository<FunctionDeobfuscation, UUID> {

    List<FunctionDeobfuscation> findByProjectId(UUID projectId);

    Optional<FunctionDeobfuscation> findByProjectIdAndOriginalName(UUID projectId, String originalName);

    void deleteByProjectIdAndOriginalName(UUID projectId, String originalName);
}

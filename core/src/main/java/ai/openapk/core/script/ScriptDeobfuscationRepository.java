package ai.openapk.core.script;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ScriptDeobfuscationRepository extends JpaRepository<ScriptDeobfuscation, UUID> {

    /** Everything saved for a project — loaded in one shot when the view mounts. */
    List<ScriptDeobfuscation> findAllByProjectId(UUID projectId);

    Optional<ScriptDeobfuscation> findByProjectIdAndFilePathAndEngine(
            UUID projectId, String filePath, String engine);

    void deleteByProjectIdAndFilePathAndEngine(UUID projectId, String filePath, String engine);
}

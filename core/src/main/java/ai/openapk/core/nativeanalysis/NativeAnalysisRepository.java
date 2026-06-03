package ai.openapk.core.nativeanalysis;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NativeAnalysisRepository extends JpaRepository<NativeAnalysis, UUID> {

    List<NativeAnalysis> findAllByProjectId(UUID projectId);

    Optional<NativeAnalysis> findByProjectIdAndLibPath(UUID projectId, String libPath);
}

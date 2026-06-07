package ai.openapk.core.script;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ScriptAnalysisRepository extends JpaRepository<ScriptAnalysis, UUID> {
}

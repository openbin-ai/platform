package ai.openapk.core.renames;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRenameRepository extends JpaRepository<ProjectRename, UUID> {
    List<ProjectRename> findByProjectIdOrderByCreatedAtDesc(UUID projectId);
    List<ProjectRename> findByProjectIdAndStatus(UUID projectId, RenameStatus status);

    /**
     * Every row for a symbol name, across scopes. Since V39 an `original`
     * can appear once per source_path (a variable named uVar1 may be
     * renamed independently inside many functions), so callers that work
     * from a bare name — apply/unapply from the review panel — must handle
     * the whole set rather than a single row.
     */
    List<ProjectRename> findAllByProjectIdAndOriginal(UUID projectId, String original);

    /**
     * The one row for (project, original, sourcePath), matching the V39
     * unique index. NULL and '' sourcePath are treated as the same bucket —
     * mirroring the index's COALESCE — so a derived query can't be used
     * here (SQL `= NULL` never matches).
     */
    @Query("""
            SELECT r FROM ProjectRename r
            WHERE r.project.id = :projectId
              AND r.original = :original
              AND COALESCE(r.sourcePath, '') = COALESCE(:sourcePath, '')
            """)
    Optional<ProjectRename> findScoped(@Param("projectId") UUID projectId,
                                       @Param("original") String original,
                                       @Param("sourcePath") String sourcePath);
}

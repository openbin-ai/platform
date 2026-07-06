package ai.openapk.core.projects;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

public interface ProjectPresenceRepository extends JpaRepository<ProjectPresence, ProjectPresence.Id> {

    @Query("select p from ProjectPresence p where p.id.projectId = :projectId")
    List<ProjectPresence> findAllByProjectId(@Param("projectId") UUID projectId);

    /**
     * Upsert the caller's last-active timestamp. Native ON CONFLICT so a
     * heartbeat is a single round trip with no read-modify-write race when
     * two of the user's tabs ping at once.
     */
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO project_presence (project_id, user_id, last_active_at)
            VALUES (:projectId, :userId, now())
            ON CONFLICT (project_id, user_id)
            DO UPDATE SET last_active_at = now()
            """, nativeQuery = true)
    void touch(@Param("projectId") UUID projectId, @Param("userId") UUID userId);
}

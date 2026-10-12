package ai.openapk.core.ctf.dto;

import ai.openapk.core.projects.ProjectKind;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Wire types for the CTF surface. Flags and hashes never appear here. */
public final class CtfDtos {

    private CtfDtos() {}

    public record Solver(UUID userId, String displayName, String emailMd5) {}

    public record SolveRow(
            UUID userId, String displayName, String emailMd5,
            Instant solvedAt, int rank, int points, boolean aiAssisted,
            UUID writeupProjectId
    ) {}

    /** The viewer's own solve, if any. */
    public record MySolve(Instant solvedAt, int rank, int points, boolean aiAssisted, UUID writeupProjectId) {}

    public record ChallengeSummary(
            UUID id, String slug, String title, ProjectKind kind,
            Instant startsAt, Instant endsAt, String season, boolean live,
            long solveCount, Solver firstBlood
    ) {}

    public record ChallengeDetail(
            UUID id, String slug, String title, String description, ProjectKind kind,
            UUID projectId, String flagHint,
            Instant startsAt, Instant endsAt, String season, boolean live, boolean started,
            long solveCount, long attemptCount,
            List<SolveRow> solves,
            MySolve mine
    ) {}

    /** Upcoming challenge teaser: no project, no description. */
    public record Upcoming(String slug, String title, ProjectKind kind, Instant startsAt, Instant endsAt) {}

    public record ResearcherOfTheWeek(Solver solver, String challengeSlug, String challengeTitle,
                                      Instant solvedAt, boolean aiAssisted) {}

    public record LeaderboardRow(int position, UUID userId, String displayName, String emailMd5,
                                 long points, long solves, long firstBloods) {}

    public record Leaderboard(String scope, String season, List<LeaderboardRow> rows) {}

    public record CtfHome(
            ChallengeDetail live,
            Upcoming upcoming,
            ResearcherOfTheWeek researcherOfTheWeek,
            Leaderboard leaderboard,
            List<ChallengeSummary> recent
    ) {}

    public record UserStats(long points, long solves, long firstBloods) {}

    // ---- requests ------------------------------------------------------------

    public record SubmitRequest(
            @NotBlank @Size(max = 512) String flag,
            Boolean aiAssisted
    ) {}

    public record SubmitResult(boolean correct, Integer rank, Integer points, boolean firstBlood) {}

    public record WriteupRequest(@NotNull UUID projectId) {}

    /** Admin create/update. Flag is write-only and optional on update. */
    public record AdminUpsertRequest(
            @NotNull UUID projectId,
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,62}") String slug,
            @NotBlank @Size(max = 200) String title,
            @Size(max = 20_000) String description,
            @Size(max = 512) String flag,
            @Size(max = 120) String flagHint,
            @NotNull Instant startsAt,
            @NotNull Instant endsAt
    ) {}

    public record AdminChallengeRow(
            UUID id, String slug, String title, ProjectKind kind, UUID projectId, String flagHint,
            Instant startsAt, Instant endsAt, String season, Instant announcedAt,
            long solveCount, long attemptCount, Solver firstBlood
    ) {}
}

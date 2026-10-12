package ai.openapk.core.ctf;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.ctf.dto.CtfDtos.AdminChallengeRow;
import ai.openapk.core.ctf.dto.CtfDtos.AdminUpsertRequest;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeDetail;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeSummary;
import ai.openapk.core.ctf.dto.CtfDtos.CtfHome;
import ai.openapk.core.ctf.dto.CtfDtos.Leaderboard;
import ai.openapk.core.ctf.dto.CtfDtos.LeaderboardRow;
import ai.openapk.core.ctf.dto.CtfDtos.MySolve;
import ai.openapk.core.ctf.dto.CtfDtos.ResearcherOfTheWeek;
import ai.openapk.core.ctf.dto.CtfDtos.SolveRow;
import ai.openapk.core.ctf.dto.CtfDtos.Solver;
import ai.openapk.core.ctf.dto.CtfDtos.SubmitResult;
import ai.openapk.core.ctf.dto.CtfDtos.Upcoming;
import ai.openapk.core.ctf.dto.CtfDtos.UserStats;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectService;
import ai.openapk.core.reports.CommunityService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Weekly CTF rules in one place.
 *
 * <ul>
 *   <li>Flags are compared as {@code sha256(salt ':' trimmed-flag)}; the
 *       plaintext is never stored and never logged.</li>
 *   <li>Rank is arrival order among solves inside the window: 1 is first
 *       blood. Solves after {@code endsAt} get rank 0 and archive points, so
 *       old challenges stay worth doing without touching the week's board.</li>
 *   <li>Points: 100 for first blood, minus 10 per rank, floor 50; archive 20.</li>
 *   <li>Attempts are rate limited per user (5 per 10 minutes) with a
 *       database count, so the limit survives restarts and multiple
 *       instances.</li>
 *   <li>Season is the calendar quarter of {@code startsAt} in UTC.</li>
 * </ul>
 *
 * Creating and editing challenges is exposed only through the private admin
 * controller; nothing in the public API can write a challenge.
 */
@Service
public class CtfService {

    private static final Logger log = LoggerFactory.getLogger(CtfService.class);

    static final int ATTEMPTS_PER_WINDOW = 5;
    static final Duration ATTEMPT_WINDOW = Duration.ofMinutes(10);
    static final int FIRST_BLOOD_POINTS = 100;
    static final int POINTS_STEP = 10;
    static final int FLOOR_POINTS = 50;
    static final int ARCHIVE_POINTS = 20;
    private static final int LEADERBOARD_LIMIT = 100;

    private final CtfChallengeRepository challenges;
    private final CtfSolveRepository solves;
    private final CtfSubmissionRepository submissions;
    private final UserRepository users;
    private final ProjectRepository projects;
    private final ProjectService projectService;
    private final DiscordNotifier discord;
    private final OpenApkProperties props;
    private final SecureRandom random = new SecureRandom();

    public CtfService(CtfChallengeRepository challenges, CtfSolveRepository solves,
                      CtfSubmissionRepository submissions, UserRepository users,
                      ProjectRepository projects, ProjectService projectService,
                      DiscordNotifier discord, OpenApkProperties props) {
        this.challenges = challenges;
        this.solves = solves;
        this.submissions = submissions;
        this.users = users;
        this.projects = projects;
        this.projectService = projectService;
        this.discord = discord;
        this.props = props;
    }

    // ---- scoring -----------------------------------------------------------

    static int pointsForRank(int rank) {
        if (rank <= 0) return ARCHIVE_POINTS;
        return Math.max(FLOOR_POINTS, FIRST_BLOOD_POINTS - (rank - 1) * POINTS_STEP);
    }

    static String seasonOf(Instant startsAt) {
        ZonedDateTime z = startsAt.atZone(ZoneOffset.UTC);
        int q = (z.getMonthValue() - 1) / 3 + 1;
        return z.getYear() + "-Q" + q;
    }

    static String currentSeason() {
        return seasonOf(Instant.now());
    }

    static String hashFlag(String salt, String flag) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest((salt + ":" + normalizeFlag(flag)).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    static String normalizeFlag(String flag) {
        return flag == null ? "" : flag.strip();
    }

    private String newSalt() {
        byte[] b = new byte[16];
        random.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    // ---- public reads ------------------------------------------------------

    @Transactional(readOnly = true)
    public CtfHome home(User viewerOrNull) {
        Instant now = Instant.now();
        CtfChallenge live = challenges.findLive(now).stream().findFirst().orElse(null);
        Upcoming upcoming = challenges.findUpcoming(now).stream().findFirst()
                .map(c -> new Upcoming(c.getSlug(), c.getTitle(), c.getKind(), c.getStartsAt(), c.getEndsAt()))
                .orElse(null);
        List<ChallengeSummary> recent = challenges.findStarted(now).stream().limit(8).map(this::summary).toList();
        return new CtfHome(
                live == null ? null : detail(live, viewerOrNull, now),
                upcoming,
                researcherOfTheWeek(now),
                leaderboard("season", null),
                recent
        );
    }

    @Transactional(readOnly = true)
    public List<ChallengeSummary> archive() {
        return challenges.findStarted(Instant.now()).stream().map(this::summary).toList();
    }

    @Transactional(readOnly = true)
    public ChallengeDetail get(String slug, User viewerOrNull) {
        Instant now = Instant.now();
        CtfChallenge c = requireStarted(slug, now);
        return detail(c, viewerOrNull, now);
    }

    /**
     * Leaderboard for a scope: {@code week} (the latest started challenge,
     * ranked solves in order), {@code season} (sum of points in a quarter,
     * current one when {@code season} is null) or {@code all}.
     */
    @Transactional(readOnly = true)
    public Leaderboard leaderboard(String scope, String season) {
        String s = scope == null ? "season" : scope.toLowerCase();
        switch (s) {
            case "week" -> {
                Instant now = Instant.now();
                CtfChallenge c = challenges.findStarted(now).stream().findFirst().orElse(null);
                if (c == null) return new Leaderboard("week", null, List.of());
                var rows = new ArrayList<LeaderboardRow>();
                int pos = 0;
                for (CtfSolve sv : solves.findByChallengeOrdered(c.getId())) {
                    if (sv.getRank() == 0) continue;
                    Solver who = solver(sv.getUserId());
                    rows.add(new LeaderboardRow(++pos, who.userId(), who.displayName(), who.emailMd5(),
                            sv.getPoints(), 1, sv.getRank() == 1 ? 1 : 0));
                }
                return new Leaderboard("week", c.getSlug(), rows);
            }
            case "all" -> {
                return new Leaderboard("all", null, mapLeaderboard(solves.leaderboard(null, LEADERBOARD_LIMIT)));
            }
            default -> {
                String season1 = (season == null || season.isBlank()) ? currentSeason() : season.strip();
                return new Leaderboard("season", season1, mapLeaderboard(solves.leaderboard(season1, LEADERBOARD_LIMIT)));
            }
        }
    }

    @Transactional(readOnly = true)
    public UserStats statsFor(UUID userId) {
        Object[] row = solves.statsForUser(userId);
        // Spring Data wraps a single-row native projection one level deeper.
        if (row != null && row.length == 1 && row[0] instanceof Object[] inner) row = inner;
        if (row == null || row.length < 3) return new UserStats(0, 0, 0);
        return new UserStats(num(row[0]), num(row[1]), num(row[2]));
    }

    @Transactional(readOnly = true)
    public List<SolveRow> mySolves(User user) {
        return solves.findByUserIdOrderBySolvedAtDesc(user.getId()).stream()
                .map(s -> toRow(s, solver(user)))
                .toList();
    }

    // ---- solving -----------------------------------------------------------

    @Transactional
    public SubmitResult submit(User user, String slug, String flag, boolean aiAssisted) {
        Instant now = Instant.now();
        CtfChallenge c = requireStarted(slug, now);
        if (solves.findByChallengeIdAndUserId(c.getId(), user.getId()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "you already solved this challenge");
        }
        long recent = submissions.countByUserIdAndSubmittedAtAfter(user.getId(), now.minus(ATTEMPT_WINDOW));
        if (recent >= ATTEMPTS_PER_WINDOW) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "too many attempts; try again in a few minutes");
        }
        boolean correct = hashFlag(c.getFlagSalt(), flag).equals(c.getFlagHash());

        CtfSubmission sub = new CtfSubmission();
        sub.setId(UUID.randomUUID());
        sub.setChallengeId(c.getId());
        sub.setUserId(user.getId());
        sub.setSubmittedAt(now);
        sub.setCorrect(correct);
        submissions.save(sub);

        if (!correct) return new SubmitResult(false, null, null, false);

        int rank = c.isLive(now) ? (int) solves.countByChallengeIdAndRankGreaterThan(c.getId(), 0) + 1 : 0;
        CtfSolve s = new CtfSolve();
        s.setId(UUID.randomUUID());
        s.setChallengeId(c.getId());
        s.setUserId(user.getId());
        s.setSolvedAt(now);
        s.setRank(rank);
        s.setPoints(pointsForRank(rank));
        s.setAiAssisted(aiAssisted);
        try {
            solves.saveAndFlush(s);
        } catch (DataIntegrityViolationException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "you already solved this challenge");
        }
        log.info("ctf solve challenge={} user={} rank={} points={}", c.getSlug(), user.getId(), rank, s.getPoints());
        if (rank == 1) {
            discord.post(":drop_of_blood: **First blood** on **" + c.getTitle() + "** by **"
                    + solver(user).displayName() + "**" + (aiAssisted ? " (AI-assisted)" : "")
                    + "\n" + challengeUrl(c));
        }
        return new SubmitResult(true, rank, s.getPoints(), rank == 1);
    }

    /** Attach a published project of the solver's as their writeup. */
    @Transactional
    public MySolve attachWriteup(User user, String slug, UUID projectId) {
        CtfChallenge c = requireStarted(slug, Instant.now());
        CtfSolve s = solves.findByChallengeIdAndUserId(c.getId(), user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "solve the challenge first"));
        Project p = projects.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        if (!user.getId().equals(p.getUser().getId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found");
        }
        if (p.getPublicReadAt() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "make the project public first so other researchers can read the writeup");
        }
        s.setWriteupProjectId(p.getId());
        solves.save(s);
        return mine(s);
    }

    // ---- admin (called only from the private admin controller) ------------

    @Transactional
    public AdminChallengeRow adminCreate(User admin, AdminUpsertRequest req) {
        if (req.flag() == null || normalizeFlag(req.flag()).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "flag is required");
        }
        if (!req.endsAt().isAfter(req.startsAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endsAt must be after startsAt");
        }
        if (challenges.findBySlug(req.slug()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "slug already used");
        }
        Project p = requireOwnedProject(admin, req.projectId());
        // The challenge binary must be readable by everyone who plays.
        projectService.setPublic(admin, p.getId(), true);

        CtfChallenge c = new CtfChallenge();
        c.setId(UUID.randomUUID());
        c.setSlug(req.slug());
        c.setTitle(req.title().strip());
        c.setDescription(req.description() == null ? "" : req.description());
        c.setKind(p.getKind());
        c.setProjectId(p.getId());
        c.setCreatedBy(admin.getId());
        String salt = newSalt();
        c.setFlagSalt(salt);
        c.setFlagHash(hashFlag(salt, req.flag()));
        c.setFlagHint(blankToNull(req.flagHint()));
        c.setStartsAt(req.startsAt());
        c.setEndsAt(req.endsAt());
        c.setSeason(seasonOf(req.startsAt()));
        challenges.save(c);
        return adminRow(c);
    }

    @Transactional
    public AdminChallengeRow adminUpdate(User admin, UUID id, AdminUpsertRequest req) {
        CtfChallenge c = challenges.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "challenge not found"));
        if (!req.endsAt().isAfter(req.startsAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endsAt must be after startsAt");
        }
        challenges.findBySlug(req.slug()).filter(o -> !o.getId().equals(id)).ifPresent(o -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "slug already used");
        });
        if (!req.projectId().equals(c.getProjectId())) {
            Project p = requireOwnedProject(admin, req.projectId());
            projectService.setPublic(admin, p.getId(), true);
            c.setProjectId(p.getId());
            c.setKind(p.getKind());
        }
        c.setSlug(req.slug());
        c.setTitle(req.title().strip());
        c.setDescription(req.description() == null ? "" : req.description());
        c.setFlagHint(blankToNull(req.flagHint()));
        c.setStartsAt(req.startsAt());
        c.setEndsAt(req.endsAt());
        c.setSeason(seasonOf(req.startsAt()));
        if (req.flag() != null && !normalizeFlag(req.flag()).isEmpty()) {
            String salt = newSalt();
            c.setFlagSalt(salt);
            c.setFlagHash(hashFlag(salt, req.flag()));
        }
        c.setUpdatedAt(Instant.now());
        challenges.save(c);
        return adminRow(c);
    }

    @Transactional
    public void adminDelete(UUID id) {
        challenges.deleteById(id);
    }

    @Transactional(readOnly = true)
    public List<AdminChallengeRow> adminList() {
        return challenges.findAllByOrderByStartsAtDesc().stream().map(this::adminRow).toList();
    }

    /** Post the "now live" message now, regardless of the window. */
    @Transactional
    public void adminAnnounce(UUID id) {
        CtfChallenge c = challenges.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "challenge not found"));
        announce(c);
    }

    /** Called by {@link CtfScheduler}: announce every started challenge exactly once. */
    @Transactional
    public void announceStartedChallenges() {
        if (!discord.enabled()) return;
        for (CtfChallenge c : challenges.findStartedUnannounced(Instant.now())) {
            announce(c);
        }
    }

    private void announce(CtfChallenge c) {
        discord.post(":triangular_flag_on_post: **New challenge: " + c.getTitle() + "** ("
                + c.getKind() + ") is live until <t:" + c.getEndsAt().getEpochSecond() + ":f>. "
                + "First correct flag is Researcher of the Week.\n" + challengeUrl(c));
        c.setAnnouncedAt(Instant.now());
        challenges.save(c);
    }

    // ---- helpers ------------------------------------------------------------

    private CtfChallenge requireStarted(String slug, Instant now) {
        CtfChallenge c = challenges.findBySlug(slug)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "challenge not found"));
        // An unstarted challenge is invisible: same 404 so the slug leaks nothing.
        if (!c.hasStarted(now)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "challenge not found");
        return c;
    }

    private Project requireOwnedProject(User admin, UUID projectId) {
        Project p = projects.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        if (!admin.getId().equals(p.getUser().getId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "the challenge project must be owned by you");
        }
        if (p.getKind() == ProjectKind.SCRIPT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "script projects cannot be challenges");
        }
        return p;
    }

    private ChallengeDetail detail(CtfChallenge c, User viewerOrNull, Instant now) {
        List<CtfSolve> list = solves.findByChallengeOrdered(c.getId());
        Map<UUID, Solver> who = solversFor(list);
        List<SolveRow> rows = list.stream().map(s -> toRow(s, who.get(s.getUserId()))).toList();
        MySolve mine = viewerOrNull == null ? null : list.stream()
                .filter(s -> s.getUserId().equals(viewerOrNull.getId())).findFirst().map(this::mine).orElse(null);
        return new ChallengeDetail(
                c.getId(), c.getSlug(), c.getTitle(), c.getDescription(), c.getKind(),
                c.getProjectId(), c.getFlagHint(),
                c.getStartsAt(), c.getEndsAt(), c.getSeason(), c.isLive(now), c.hasStarted(now),
                list.size(), submissions.countByChallengeId(c.getId()),
                rows, mine
        );
    }

    private ChallengeSummary summary(CtfChallenge c) {
        Instant now = Instant.now();
        Solver first = solves.findByChallengeIdAndRank(c.getId(), 1).map(s -> solver(s.getUserId())).orElse(null);
        return new ChallengeSummary(c.getId(), c.getSlug(), c.getTitle(), c.getKind(),
                c.getStartsAt(), c.getEndsAt(), c.getSeason(), c.isLive(now),
                solves.countByChallengeId(c.getId()), first);
    }

    private AdminChallengeRow adminRow(CtfChallenge c) {
        Solver first = solves.findByChallengeIdAndRank(c.getId(), 1).map(s -> solver(s.getUserId())).orElse(null);
        return new AdminChallengeRow(c.getId(), c.getSlug(), c.getTitle(), c.getKind(), c.getProjectId(),
                c.getFlagHint(), c.getStartsAt(), c.getEndsAt(), c.getSeason(), c.getAnnouncedAt(),
                solves.countByChallengeId(c.getId()), submissions.countByChallengeId(c.getId()), first);
    }

    private ResearcherOfTheWeek researcherOfTheWeek(Instant now) {
        for (CtfChallenge c : challenges.findStarted(now)) {
            Optional<CtfSolve> first = solves.findByChallengeIdAndRank(c.getId(), 1);
            if (first.isPresent()) {
                CtfSolve s = first.get();
                return new ResearcherOfTheWeek(solver(s.getUserId()), c.getSlug(), c.getTitle(),
                        s.getSolvedAt(), s.isAiAssisted());
            }
        }
        return null;
    }

    private SolveRow toRow(CtfSolve s, Solver who) {
        return new SolveRow(who.userId(), who.displayName(), who.emailMd5(), s.getSolvedAt(),
                s.getRank(), s.getPoints(), s.isAiAssisted(), s.getWriteupProjectId());
    }

    private MySolve mine(CtfSolve s) {
        return new MySolve(s.getSolvedAt(), s.getRank(), s.getPoints(), s.isAiAssisted(), s.getWriteupProjectId());
    }

    private Map<UUID, Solver> solversFor(List<CtfSolve> list) {
        var ids = list.stream().map(CtfSolve::getUserId).distinct().toList();
        var out = new HashMap<UUID, Solver>();
        for (User u : users.findAllById(ids)) out.put(u.getId(), solver(u));
        for (UUID id : ids) out.putIfAbsent(id, new Solver(id, "deleted user", ""));
        return out;
    }

    private Solver solver(UUID userId) {
        return users.findById(userId).map(this::solver).orElse(new Solver(userId, "deleted user", ""));
    }

    private Solver solver(User u) {
        return new Solver(u.getId(),
                CommunityService.displayNameOrFallback(u.getDisplayName(), u.getEmail()),
                CommunityService.md5Hex(u.getEmail()));
    }

    private List<LeaderboardRow> mapLeaderboard(List<Object[]> rows) {
        var out = new ArrayList<LeaderboardRow>();
        int pos = 0;
        for (Object[] r : rows) {
            UUID id = (UUID) r[0];
            String display = CommunityService.displayNameOrFallback((String) r[1], (String) r[2]);
            out.add(new LeaderboardRow(++pos, id, display, CommunityService.md5Hex((String) r[2]),
                    num(r[3]), num(r[4]), num(r[5])));
        }
        return out;
    }

    private String challengeUrl(CtfChallenge c) {
        String base = props.web() != null && props.web().openbinUrl() != null
                ? props.web().openbinUrl().replaceAll("/+$", "") : "https://app.openbin.ai";
        return base + "/ctf/" + c.getSlug();
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}

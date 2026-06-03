package ai.openapk.core.reports;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.reports.dto.ApplyTemplateRequest;
import ai.openapk.core.reports.dto.CreateReportTemplateRequest;
import ai.openapk.core.reports.dto.ReportResponse;
import ai.openapk.core.reports.dto.ReportSection;
import ai.openapk.core.reports.dto.ReportTemplateResponse;
import ai.openapk.core.reports.dto.SaveAsTemplateRequest;
import ai.openapk.core.reports.dto.UpdateReportTemplateRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class ReportTemplateService {

    private static final Logger log = LoggerFactory.getLogger(ReportTemplateService.class);

    private final ReportTemplateRepository repo;
    private final ProjectReportRepository reportRepo;
    private final ProjectRepository projectRepo;
    private final ObjectMapper mapper;

    public ReportTemplateService(
            ReportTemplateRepository repo,
            ProjectReportRepository reportRepo,
            ProjectRepository projectRepo,
            ObjectMapper mapper
    ) {
        this.repo = repo;
        this.reportRepo = reportRepo;
        this.projectRepo = projectRepo;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<ReportTemplateResponse> list(User user) {
        return repo.findAllByUserIdOrderByNameAsc(user.getId())
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public ReportTemplateResponse get(User user, UUID id) {
        return toResponse(loadTemplate(user, id));
    }

    @Transactional
    public ReportTemplateResponse create(User user, CreateReportTemplateRequest req) {
        if (repo.existsByUserIdAndName(user.getId(), req.name())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A template with that name already exists.");
        }
        requireUniqueIds(req.sections());
        var t = new ReportTemplate();
        t.setUser(user);
        t.setName(req.name());
        t.setDescription(req.description());
        t.setMode(req.mode());
        t.setSectionsJson(serializeSections(req.sections()));
        return toResponse(repo.save(t));
    }

    @Transactional
    public ReportTemplateResponse update(User user, UUID id, UpdateReportTemplateRequest req) {
        var t = loadTemplate(user, id);
        // Name uniqueness only matters if the user is changing the name.
        if (!t.getName().equals(req.name()) && repo.existsByUserIdAndName(user.getId(), req.name())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A template with that name already exists.");
        }
        requireUniqueIds(req.sections());
        t.setName(req.name());
        t.setDescription(req.description());
        t.setMode(req.mode());
        t.setSectionsJson(serializeSections(req.sections()));
        return toResponse(repo.save(t));
    }

    @Transactional
    public void delete(User user, UUID id) {
        var t = loadTemplate(user, id);
        repo.delete(t);
    }

    /**
     * Replace the project's report sections with this template's. Title is left
     * alone unless `replaceTitle` is true. Fails 409 if the report is published —
     * caller must unpublish first (same rule as direct edits).
     */
    @Transactional
    public ReportResponse applyToProject(User user, UUID projectId, ApplyTemplateRequest req) {
        Project project = projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        ReportTemplate template = loadTemplate(user, req.templateId());

        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> {
            var r = new ProjectReport();
            r.setProject(project);
            r.setTitle(template.getName());
            r.setSectionsJson("{\"sections\":[]}");
            return reportRepo.save(r);
        });
        if (report.getPublishedAt() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Report is published. Unpublish first to apply a template.");
        }
        report.setSectionsJson(template.getSectionsJson());
        if (req.replaceTitle()) report.setTitle(template.getName());
        return toReportResponse(reportRepo.save(report));
    }

    /**
     * Snapshot the project's current report sections into a new template. Caller
     * can ask to blank section content so the template is reusable as a skeleton.
     */
    @Transactional
    public ReportTemplateResponse saveFromProject(User user, UUID projectId, SaveAsTemplateRequest req) {
        Project project = projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        ProjectReport report = reportRepo.findByProjectId(project.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No report exists for this project yet. Open the report tab first."));
        if (repo.existsByUserIdAndName(user.getId(), req.name())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A template with that name already exists.");
        }
        List<ReportSection> sections = deserializeSections(report.getSectionsJson());
        if (req.blankContent()) {
            sections = sections.stream()
                    .map(s -> new ReportSection(s.id(), s.title(), ""))
                    .toList();
        }
        var t = new ReportTemplate();
        t.setUser(user);
        t.setName(req.name());
        t.setDescription(req.description());
        t.setMode(req.mode());
        t.setSectionsJson(serializeSections(sections));
        return toResponse(repo.save(t));
    }

    private ReportTemplate loadTemplate(User user, UUID id) {
        return repo.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "template not found"));
    }

    /**
     * Section IDs are persisted as map keys downstream (populate, render, etc.),
     * so a duplicate inside a single template would corrupt those flows. Reject
     * at the boundary.
     */
    private void requireUniqueIds(List<ReportSection> sections) {
        Set<String> seen = new HashSet<>();
        for (ReportSection s : sections) {
            if (s.id() == null || s.id().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "section id is required");
            }
            if (!seen.add(s.id())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Duplicate section id in template: " + s.id());
            }
        }
    }

    private ReportTemplateResponse toResponse(ReportTemplate t) {
        return new ReportTemplateResponse(
                t.getId(), t.getName(), t.getDescription(), t.getMode(),
                deserializeSections(t.getSectionsJson()),
                t.getCreatedAt(), t.getUpdatedAt()
        );
    }

    private ReportResponse toReportResponse(ProjectReport r) {
        return new ReportResponse(
                r.getId(),
                r.getProject().getId(),
                r.getTitle(),
                deserializeSections(r.getSectionsJson()),
                r.getCreatedAt(),
                r.getUpdatedAt(),
                r.getPublishedAt(),
                r.getCommunityPublishedAt(),
                r.getMalwareType(),
                r.getTags() == null ? java.util.List.of() : java.util.List.of(r.getTags())
        );
    }

    private String serializeSections(List<ReportSection> sections) {
        try {
            return mapper.writeValueAsString(Map.of("sections", sections));
        } catch (Exception e) {
            throw new IllegalStateException("section serialization failed", e);
        }
    }

    private List<ReportSection> deserializeSections(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            Map<String, List<ReportSection>> root = mapper.readValue(json, new TypeReference<Map<String, List<ReportSection>>>() {});
            return root.getOrDefault("sections", List.of());
        } catch (Exception e) {
            log.warn("template section deserialization failed: {}", e.toString());
            return List.of();
        }
    }
}

package ai.openapk.core.ctf;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.ctf.dto.CtfDtos.MySolve;
import ai.openapk.core.ctf.dto.CtfDtos.SolveRow;
import ai.openapk.core.ctf.dto.CtfDtos.SubmitRequest;
import ai.openapk.core.ctf.dto.CtfDtos.SubmitResult;
import ai.openapk.core.ctf.dto.CtfDtos.WriteupRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Authenticated CTF actions: submit a flag, attach a writeup, list my solves. */
@RestController
@RequestMapping("/api/ctf")
public class CtfController {

    private final CtfService service;
    private final CurrentUserService currentUser;

    public CtfController(CtfService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @PostMapping("/challenges/{slug}/submit")
    public SubmitResult submit(@PathVariable String slug, @Valid @RequestBody SubmitRequest req) {
        return service.submit(currentUser.current(), slug, req.flag(), Boolean.TRUE.equals(req.aiAssisted()));
    }

    @PostMapping("/challenges/{slug}/writeup")
    public MySolve writeup(@PathVariable String slug, @Valid @RequestBody WriteupRequest req) {
        return service.attachWriteup(currentUser.current(), slug, req.projectId());
    }

    @GetMapping("/me")
    public List<SolveRow> mine() {
        return service.mySolves(currentUser.current());
    }
}

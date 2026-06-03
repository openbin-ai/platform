package ai.openapk.core.dbschema;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.dbschema.dto.DbSchema;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/dbschemas")
public class DbSchemaController {

    private final DbSchemaService service;
    private final CurrentUserService currentUser;

    public DbSchemaController(DbSchemaService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<DbSchema> scan(
            @PathVariable("id") UUID id,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks
    ) {
        return service.scan(currentUser.current(), id, includeSdks);
    }
}

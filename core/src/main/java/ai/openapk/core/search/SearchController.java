package ai.openapk.core.search;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.search.dto.SearchHit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/search")
public class SearchController {

    private final SearchService service;
    private final CurrentUserService currentUser;

    public SearchController(SearchService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<SearchHit> search(
            @PathVariable("id") UUID id,
            @RequestParam("q") String q,
            @RequestParam(value = "caseSensitive", defaultValue = "false") boolean caseSensitive,
            @RequestParam(value = "regex", defaultValue = "false") boolean regex,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks,
            @RequestParam(value = "limit", defaultValue = "200") int limit
    ) {
        return service.search(currentUser.current(), id, q, caseSensitive, regex, includeSdks, limit);
    }
}

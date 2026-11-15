package ai.openapk.core.callchain;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.auth.User;
import ai.openapk.core.callchain.dto.CallChain;
import ai.openapk.core.callchain.dto.ChildrenStats;
import ai.openapk.core.callchain.dto.MethodRef;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.analysis.BinaryAnalysisLoader;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.symbols.SymbolService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Regression for the 2026-11-09 LFI report: POST /callchains/narrate echoed a
 * chain back from the client, and the body-reader resolved {@code root.file}
 * against the project srcDir with no containment check. A crafted
 * {@code ../../../../etc/passwd} was read off disk and embedded in the prompt
 * narrate sends to the caller's own BYOK endpoint — arbitrary-file exfil.
 *
 * <p>These are pure-Mockito unit tests: no DB, no real files. The point is
 * that a traversal path is rejected BEFORE the LLM is ever invoked, so there
 * is no exfiltration channel even if a file happened to exist.
 */
class CallChainNarratePathTraversalTest {

    private final SymbolService symbolService = mock(SymbolService.class);
    private final ProjectStorage storage = mock(ProjectStorage.class);
    private final RenameService renameService = mock(RenameService.class);
    private final LlmInvoker invoker = mock(LlmInvoker.class);
    private final LlmCredentialRepository credRepo = mock(LlmCredentialRepository.class);
    private final BinaryAnalysisLoader analysisLoader = mock(BinaryAnalysisLoader.class);
    private final ProjectAccessGuard guard = mock(ProjectAccessGuard.class);

    private final CallChainService service = new CallChainService(
            symbolService, storage, renameService, invoker, credRepo,
            new ObjectMapper(), analysisLoader, guard);

    private CallChain chainWithRootFile(String file) {
        MethodRef root = new MethodRef("c", "m", "()V", file, 1);
        return new CallChain(root, null, "", List.of(), List.of(),
                ChildrenStats.EMPTY, ChildrenStats.EMPTY);
    }

    private void wireProject(Path srcDir, UUID userId, UUID projectId) {
        User user = mock(User.class);
        when(user.getId()).thenReturn(userId);
        Project project = mock(Project.class);
        when(project.getUser()).thenReturn(user);
        when(guard.requireRead(any(), eq(projectId))).thenReturn(project);
        when(storage.srcDir(userId, projectId)).thenReturn(srcDir);
        when(credRepo.findByIdAndUserId(any(), any())).thenReturn(Optional.of(mock(LlmCredential.class)));
    }

    @Test
    void relativeTraversalIsRejectedAndLlmNeverCalled() {
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        wireProject(Path.of("/srv/workspace/u/p").normalize(), userId, projectId);
        UUID credId = UUID.randomUUID();

        assertThatThrownBy(() -> service.narrate(mock(User.class), projectId,
                chainWithRootFile("../../../../../../../../etc/passwd"), credId, null))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        verify(invoker, never()).complete(any(), any(), anyString(), any(), anyString(), anyString(), anyInt(), any());
    }

    @Test
    void absolutePathIsRejectedAndLlmNeverCalled() {
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        wireProject(Path.of("/srv/workspace/u/p").normalize(), userId, projectId);
        UUID credId = UUID.randomUUID();

        assertThatThrownBy(() -> service.narrate(mock(User.class), projectId,
                chainWithRootFile("/proc/self/environ"), credId, null))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        verifyNoInteractions(invoker);
    }

    @Test
    void helperAcceptsInProjectPathAndRejectsEscape() {
        Path root = Path.of("/srv/workspace/u/p").normalize();
        // In-project relative path stays under root.
        assertThat(root.resolve("com/app/Main.java").normalize().startsWith(root)).isTrue();
        // Escapes are caught by the same normalize + startsWith the service uses.
        assertThat(root.resolve("../../../../etc/passwd").normalize().startsWith(root)).isFalse();
    }
}

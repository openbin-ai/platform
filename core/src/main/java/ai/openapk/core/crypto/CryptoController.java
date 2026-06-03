package ai.openapk.core.crypto;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.crypto.dto.CryptoHit;
import ai.openapk.core.crypto.dto.GenerateBinDecryptorRequest;
import ai.openapk.core.crypto.dto.GenerateBinDecryptorResponse;
import ai.openapk.core.crypto.dto.GenerateDecryptorRequest;
import ai.openapk.core.crypto.dto.GenerateDecryptorResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/crypto")
public class CryptoController {

    private final CryptoService service;
    private final CurrentUserService currentUser;

    public CryptoController(CryptoService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping("/hits")
    public List<CryptoHit> hits(
            @PathVariable("id") UUID id,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks
    ) {
        return service.listHits(currentUser.current(), id, includeSdks);
    }

    @PostMapping("/generate")
    public GenerateDecryptorResponse generate(
            @PathVariable("id") UUID id,
            @Valid @RequestBody GenerateDecryptorRequest req
    ) {
        return service.generate(currentUser.current(), id, req);
    }

    /**
     * BIN-only: generate a Python decryptor from a single function's
     * decompiled C. Simpler shape than the APK generate path — no
     * project-wide ciphertext harvesting, no CyberChef recipe.
     */
    @PostMapping("/generate-bin")
    public GenerateBinDecryptorResponse generateForFunction(
            @PathVariable("id") UUID id,
            @Valid @RequestBody GenerateBinDecryptorRequest req
    ) {
        return service.generateForFunction(currentUser.current(), id, req);
    }
}

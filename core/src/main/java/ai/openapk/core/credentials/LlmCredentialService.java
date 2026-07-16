package ai.openapk.core.credentials;

import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.dto.CreateCredentialRequest;
import ai.openapk.core.credentials.dto.CredentialResponse;
import ai.openapk.core.credentials.dto.TestResultResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class LlmCredentialService {

    private final LlmCredentialRepository repo;
    private final LlmCredentialEncryptionService crypto;
    private final LlmCredentialPayloadCodec codec;
    private final LlmCredentialTester tester;
    private final LlmModelCatalog modelCatalog;

    public LlmCredentialService(
            LlmCredentialRepository repo,
            LlmCredentialEncryptionService crypto,
            LlmCredentialPayloadCodec codec,
            LlmCredentialTester tester,
            LlmModelCatalog modelCatalog
    ) {
        this.repo = repo;
        this.crypto = crypto;
        this.codec = codec;
        this.tester = tester;
        this.modelCatalog = modelCatalog;
    }

    @Transactional(readOnly = true)
    public List<CredentialResponse> list(User user) {
        return repo.findAllByUserIdOrderByCreatedAtDesc(user.getId())
                .stream().map(CredentialResponse::from).toList();
    }

    @Transactional
    public CredentialResponse create(User user, CreateCredentialRequest req) {
        if (repo.existsByUserIdAndLabel(user.getId(), req.label())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A credential with that label already exists.");
        }
        var payload = buildPayload(req);
        byte[] json = codec.toJson(payload);
        var enc = crypto.encrypt(json);

        var entity = new LlmCredential();
        entity.setUser(user);
        entity.setProvider(req.provider());
        entity.setLabel(req.label());
        entity.setPayloadCiphertext(enc.ciphertext());
        entity.setPayloadIv(enc.iv());
        return CredentialResponse.from(repo.save(entity));
    }

    /**
     * Live model IDs available to this credential (queried from the provider +
     * cached). Powers the frontend model picker, so we never hardcode a list.
     * Returns empty if the provider's {@code /models} can't be reached.
     */
    @Transactional(readOnly = true)
    public List<String> listModels(User user, UUID id) {
        var c = repo.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
        return modelCatalog.listModels(c);
    }

    @Transactional
    public void delete(User user, UUID id) {
        var c = repo.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
        repo.delete(c);
    }

    @Transactional
    public TestResultResponse test(User user, UUID id) {
        var c = repo.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
        byte[] json = crypto.decrypt(c.getPayloadCiphertext(), c.getPayloadIv());
        var payload = codec.fromJson(json, c.getProvider());
        var result = tester.test(c.getProvider(), payload);
        c.setLastTestStatus(result.status());
        c.setLastTestMessage(result.message());
        c.setLastTestAt(Instant.now());
        return result;
    }

    private LlmCredentialPayload buildPayload(CreateCredentialRequest req) {
        return switch (req.provider().kind()) {
            case ANTHROPIC -> {
                requireField(req.apiKey(), "apiKey");
                yield new LlmCredentialPayload.Anthropic(req.apiKey());
            }
            case OPENAI -> {
                requireField(req.apiKey(), "apiKey");
                // Named OpenAI-compatible providers get their base URL from the
                // enum (baseUrl stays null); the generic OPENAI_COMPAT provider
                // requires the user to supply one.
                String baseUrl = req.baseUrl();
                if (req.provider() == LlmProvider.OPENAI_COMPAT) {
                    requireField(baseUrl, "baseUrl");
                } else {
                    baseUrl = null;
                }
                yield new LlmCredentialPayload.OpenAI(req.apiKey(), baseUrl);
            }
            case BEDROCK -> {
                requireField(req.accessKeyId(), "accessKeyId");
                requireField(req.secretAccessKey(), "secretAccessKey");
                requireField(req.region(), "region");
                yield new LlmCredentialPayload.Bedrock(
                        req.accessKeyId(),
                        req.secretAccessKey(),
                        req.sessionToken(),
                        req.region()
                );
            }
        };
    }

    private void requireField(String s, String name) {
        if (s == null || s.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    name + " is required for this provider");
        }
    }
}

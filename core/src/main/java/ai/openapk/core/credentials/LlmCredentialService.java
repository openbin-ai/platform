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

    public LlmCredentialService(
            LlmCredentialRepository repo,
            LlmCredentialEncryptionService crypto,
            LlmCredentialPayloadCodec codec,
            LlmCredentialTester tester
    ) {
        this.repo = repo;
        this.crypto = crypto;
        this.codec = codec;
        this.tester = tester;
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
        return switch (req.provider()) {
            case ANTHROPIC -> {
                requireField(req.apiKey(), "apiKey");
                yield new LlmCredentialPayload.Anthropic(req.apiKey());
            }
            case OPENAI -> {
                requireField(req.apiKey(), "apiKey");
                yield new LlmCredentialPayload.OpenAI(req.apiKey());
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

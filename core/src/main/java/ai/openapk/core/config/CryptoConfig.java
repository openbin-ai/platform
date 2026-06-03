package ai.openapk.core.config;

import ai.openapk.core.credentials.LlmCredentialEncryptionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

@Configuration
public class CryptoConfig {

    @Bean
    LlmCredentialEncryptionService llmCredentialEncryptionService(OpenApkProperties props) {
        String b64 = props.crypto() == null ? null : props.crypto().masterKeyB64();
        if (b64 == null || b64.isBlank()) {
            throw new IllegalStateException(
                    "OPENAPK_KEK_B64 is not set. Generate one with `openssl rand -base64 32` " +
                    "and export it before starting the app.");
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(b64);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("OPENAPK_KEK_B64 is not valid base64", e);
        }
        if (raw.length != 32) {
            throw new IllegalStateException(
                    "OPENAPK_KEK_B64 must decode to 32 bytes for AES-256, got " + raw.length);
        }
        return new LlmCredentialEncryptionService(new SecretKeySpec(raw, "AES"));
    }
}

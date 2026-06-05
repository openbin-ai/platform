package ai.openapk.core.projects.analysis;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cloudfront.CloudFrontUtilities;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Wires up the S3 client + presigner + CloudFront URL signer for the
 * analysis-blob bucket (separate from the media bucket configured in
 * {@code StorageS3Config}). Conditional on
 * {@code openapk.analysis-storage.bucket} being set so dev profiles
 * without analysis storage configured still boot.
 */
@Configuration
@ConditionalOnProperty(name = "openapk.analysis-storage.bucket")
public class AnalysisStorageConfig {

    private static final Logger log = LoggerFactory.getLogger(AnalysisStorageConfig.class);

    @Bean(name = "analysisS3Client")
    public S3Client analysisS3Client(OpenApkProperties props) {
        var a = require(props);
        var builder = S3Client.builder()
                .region(Region.of(a.region()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (a.endpoint() != null && !a.endpoint().isBlank()) {
            builder.endpointOverride(URI.create(a.endpoint()))
                   .serviceConfiguration(S3Configuration.builder()
                           .pathStyleAccessEnabled(true)
                           .build());
        }
        log.info("analysis S3 client ready: bucket={} region={}", a.bucket(), a.region());
        return builder.build();
    }

    @Bean(name = "analysisS3Presigner")
    public S3Presigner analysisS3Presigner(OpenApkProperties props) {
        var a = require(props);
        var builder = S3Presigner.builder()
                .region(Region.of(a.region()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (a.endpoint() != null && !a.endpoint().isBlank()) {
            builder.endpointOverride(URI.create(a.endpoint()))
                   .serviceConfiguration(S3Configuration.builder()
                           .pathStyleAccessEnabled(true)
                           .build());
        }
        return builder.build();
    }

    /**
     * CloudFront utilities for minting signed GET URLs. Stateless; the
     * private key is read lazily inside {@link CloudFrontUrlSigner}
     * because Secrets Manager calls shouldn't fire during bean init
     * (slow + can break the startup probe if AWS is flaky).
     */
    @Bean
    public CloudFrontUtilities cloudFrontUtilities() {
        return CloudFrontUtilities.create();
    }

    /**
     * Resolves the CloudFront private key from either a file or Secrets
     * Manager based on
     * {@code openapk.analysis-storage.cloudfront.private-key.source}.
     * Returns null when signing isn't configured — callers must handle
     * the no-signer case (Phase 1 still allows reads via the legacy
     * JSONB path).
     */
    @Bean
    public CloudFrontUrlSigner cloudFrontUrlSigner(
            OpenApkProperties props,
            CloudFrontUtilities cfUtils
    ) {
        var cf = require(props).cloudfront();
        if (cf == null || cf.privateKey() == null
                || cf.distributionDomain() == null || cf.keyPairId() == null) {
            log.warn("CloudFront URL signer not configured — frontend will fall back to JSONB reads");
            return new CloudFrontUrlSigner(cfUtils, null, null, null);
        }
        var pk = cf.privateKey();
        Path keyPath = resolveKeyPath(pk);
        return new CloudFrontUrlSigner(cfUtils, cf.distributionDomain(), cf.keyPairId(), keyPath);
    }

    /**
     * Materializes the private-key PEM to a {@link Path} the AWS SDK
     * can read. File source returns directly; Secrets Manager source
     * pulls the secret value once at startup and writes a 0600 temp
     * file the SDK can read. We don't keep the PEM string in memory
     * because the SDK API specifically wants a Path.
     */
    private static Path resolveKeyPath(OpenApkProperties.AnalysisStorage.CloudFront.PrivateKey pk) {
        if ("file".equalsIgnoreCase(pk.source())) {
            if (pk.filePath() == null || pk.filePath().isBlank()) {
                throw new IllegalStateException(
                        "openapk.analysis-storage.cloudfront.private-key.source=file " +
                        "but .file-path is unset");
            }
            return Paths.get(pk.filePath());
        }
        if ("secretsmanager".equalsIgnoreCase(pk.source())) {
            if (pk.secretArn() == null || pk.secretArn().isBlank()) {
                throw new IllegalStateException(
                        "openapk.analysis-storage.cloudfront.private-key.source=secretsmanager " +
                        "but .secret-arn is unset");
            }
            return SecretsManagerKeyMaterializer.materialize(pk.secretArn());
        }
        throw new IllegalStateException(
                "openapk.analysis-storage.cloudfront.private-key.source must be " +
                "'file' or 'secretsmanager', got: " + pk.source());
    }

    private static OpenApkProperties.AnalysisStorage require(OpenApkProperties props) {
        var a = props.analysisStorage();
        if (a == null || a.bucket() == null || a.bucket().isBlank()) {
            throw new IllegalStateException(
                    "openapk.analysis-storage.bucket is unset but analysis storage beans were requested");
        }
        if (a.region() == null || a.region().isBlank()) {
            throw new IllegalStateException(
                    "openapk.analysis-storage.region is unset");
        }
        return a;
    }

    /** Tiny helper kept here to avoid spawning another file for ~15 lines. */
    static final class SecretsManagerKeyMaterializer {
        static Path materialize(String secretArn) {
            try (var sm = software.amazon.awssdk.services.secretsmanager.SecretsManagerClient.create()) {
                String pem = sm.getSecretValue(
                        b -> b.secretId(secretArn)
                ).secretString();
                Path tmp = Files.createTempFile("cf-signing-", ".pem");
                tmp.toFile().setReadable(false, false);
                tmp.toFile().setReadable(true, true);
                Files.writeString(tmp, pem);
                tmp.toFile().deleteOnExit();
                return tmp;
            } catch (Exception e) {
                throw new IllegalStateException(
                        "Failed to load CloudFront private key from Secrets Manager: " + secretArn, e);
            }
        }
    }
}

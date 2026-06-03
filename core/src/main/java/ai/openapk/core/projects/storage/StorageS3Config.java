package ai.openapk.core.projects.storage;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;

/**
 * S3 client + presigner Spring beans, conditional on
 * {@code openapk.storage.backend=s3}. With the fs backend (dev default)
 * these beans never get instantiated so the app runs without AWS
 * credentials configured.
 *
 * <p>Credentials come from {@link DefaultCredentialsProvider} which checks
 * env vars, the AWS profile file, then EC2/ECS task-role metadata — same
 * chain SES already uses, so prod IAM setup is shared.
 *
 * <p>{@code endpoint} is overridable so the same code runs against MinIO
 * locally (see compose.yaml) or AWS S3 in prod.
 */
@Configuration
@ConditionalOnProperty(name = "openapk.storage.backend", havingValue = "s3")
public class StorageS3Config {

    private static final Logger log = LoggerFactory.getLogger(StorageS3Config.class);

    @Bean
    public S3Client s3Client(OpenApkProperties props) {
        OpenApkProperties.Storage.S3 s3 = requireS3(props);
        var builder = S3Client.builder()
                .region(Region.of(s3.region()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (s3.endpoint() != null && !s3.endpoint().isBlank()) {
            // Path-style addressing is mandatory for MinIO and other
            // S3-compatibles that don't support virtual-hosted bucket DNS.
            builder.endpointOverride(URI.create(s3.endpoint()))
                   .serviceConfiguration(S3Configuration.builder()
                           .pathStyleAccessEnabled(true)
                           .build());
            log.info("S3 client configured with endpoint override: {}", s3.endpoint());
        }
        log.info("S3 client ready: bucket={} region={}", s3.bucket(), s3.region());
        return builder.build();
    }

    @Bean
    public S3Presigner s3Presigner(OpenApkProperties props) {
        OpenApkProperties.Storage.S3 s3 = requireS3(props);
        var builder = S3Presigner.builder()
                .region(Region.of(s3.region()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (s3.endpoint() != null && !s3.endpoint().isBlank()) {
            builder.endpointOverride(URI.create(s3.endpoint()))
                   .serviceConfiguration(S3Configuration.builder()
                           .pathStyleAccessEnabled(true)
                           .build());
        }
        return builder.build();
    }

    private static OpenApkProperties.Storage.S3 requireS3(OpenApkProperties props) {
        var s3 = props.storage() != null ? props.storage().s3() : null;
        if (s3 == null || s3.bucket() == null || s3.bucket().isBlank()) {
            throw new IllegalStateException(
                    "openapk.storage.backend=s3 but openapk.storage.s3.bucket is unset. " +
                    "Set OPENAPK_S3_BUCKET (and OPENAPK_S3_REGION) before starting.");
        }
        if (s3.region() == null || s3.region().isBlank()) {
            throw new IllegalStateException(
                    "openapk.storage.backend=s3 but openapk.storage.s3.region is unset.");
        }
        return s3;
    }
}

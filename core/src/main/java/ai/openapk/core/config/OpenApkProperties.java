package ai.openapk.core.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;

@ConfigurationProperties("openapk")
public record OpenApkProperties(
        Crypto crypto,
        Cors cors,
        Workspace workspace,
        Projects projects,
        Storage storage,
        AnalysisStorage analysisStorage,
        Ghidra ghidra,
        Jadx jadx,
        ScriptAnalyzer scriptAnalyzer,
        Workers workers,
        Email email,
        Tos tos
) {

    /**
     * Terms-of-Service config. {@code currentVersion} is the version
     * string (YYYY-MM-DD date) that {@link
     * ai.openapk.core.tos.TosAcceptanceFilter} compares against the
     * user's accepted version. Bump in lockstep with any material TOS
     * change to force a re-accept across the user base.
     */
    public record Tos(String currentVersion) {}

    public record Crypto(String masterKeyB64) {}

    public record Cors(List<String> allowedOrigins) {}

    public record Workspace(String dir) {}

    public record Projects(long maxFileResponseBytes) {}

    /**
     * Where project bytes live durably. {@code backend=fs} keeps everything
     * on the workspace filesystem (dev default — no AWS credentials needed).
     * {@code backend=s3} switches to S3 for persistence while still using the
     * workspace dir as a local cache for active projects — the {@code Path}
     * API on {@code ProjectStorage} stays intact so the 20+ services that
     * walk source trees don't need to change.
     *
     * <p>The {@code s3.*} block is only read when {@code backend=s3}; values
     * are nullable to keep the dev profile from failing fast when S3 isn't
     * configured.
     *
     * <p>Cache eviction: when free space on the workspace dir drops below
     * {@code cacheMinFreePercent}, the LRU evictor removes the projects that
     * were touched longest ago. They're re-fetched from S3 on next access.
     */
    public record Storage(
            String backend,
            S3 s3,
            Integer cacheMinFreePercent,
            Duration presignedUrlTtl
    ) {
        public record S3(String bucket, String region, String prefix, String endpoint) {}
    }

    /**
     * Dedicated bucket for BIN analysis blobs (the Ghidra worker JSON the
     * CLI uploads via presigned PUT). Decoupled from {@link Storage} so
     * dev can keep media on disk while still exercising the S3 ingest
     * path for analysis. All fields nullable so the local profile can
     * leave this block off entirely.
     *
     * <p>Reads go through CloudFront with signed URLs (see
     * {@link CloudFront}). The private key is loaded from a file in dev
     * and from Secrets Manager in prod, switched via {@code privateKey.source}.
     */
    public record AnalysisStorage(
            String bucket,
            String region,
            String prefix,
            String endpoint,
            Duration presignedPutTtl,
            Duration presignedGetTtl,
            CloudFront cloudfront
    ) {
        public record CloudFront(
                String distributionDomain,
                String keyPairId,
                PrivateKey privateKey
        ) {
            public record PrivateKey(
                    /** "file" or "secretsmanager". Anything else disables URL signing. */
                    String source,
                    /** Filesystem path to the PEM, used when source=file. */
                    String filePath,
                    /** AWS Secrets Manager ARN containing the PEM, used when source=secretsmanager. */
                    String secretArn
            ) {}
        }
    }

    /**
     * Connection details for the Ghidra worker microservice
     * (Python FastAPI + analyzeHeadless, deployed separately).
     *
     * <p>{@code workerDisabled=true} hard-fails any code path that would
     * dispatch to the cloud worker (BIN upload + per-{@code .so} analyze)
     * with the {@code GhidraSunsetMessage.TEXT} payload, pointing users at
     * the desktop CLI. Set to false to re-enable cloud decompile (e.g.
     * after sponsorship lands).
     */
    public record Ghidra(String workerUrl, Duration workerTimeout, Boolean workerDisabled) {}

    /**
     * Connection details for the JADX worker microservice
     * (Python FastAPI + jadx CLI, deployed separately). Replaces the
     * previous in-JVM JADX integration — see jadx-worker/ at the repo root.
     */
    public record Jadx(String workerUrl, Duration workerTimeout) {}

    /**
     * Configuration for the script-worker Lambda — the malicious-NPM
     * analyzer. The Lambda is the one non-ECS compute in the stack;
     * scale-to-zero economics for a sporadic, bounded workload.
     *
     * <ul>
     *   <li>{@code enabled} — defaults to false in dev so a missing
     *       function name doesn't break boot; flip to true in prod once
     *       the function exists.</li>
     *   <li>{@code lambdaFunctionName} — the Lambda function ARN or
     *       short name. Resolved by the AWS SDK against the current
     *       region.</li>
     *   <li>{@code region} — region the Lambda lives in.</li>
     *   <li>{@code maxUploadBytes} — Spring side enforcement of the
     *       tarball size cap. Lambda also enforces its own per-file +
     *       per-package limits.</li>
     *   <li>{@code invokeTimeout} — wall-clock cap on a single sync
     *       invoke. Must exceed the Lambda's own timeout (60s default)
     *       so we don't disconnect a still-working analysis.</li>
     * </ul>
     */
    public record ScriptAnalyzer(
            Boolean enabled,
            String lambdaFunctionName,
            String pypiLambdaFunctionName,
            String shellLambdaFunctionName,
            String region,
            Long maxUploadBytes,
            Duration invokeTimeout
    ) {}

    /**
     * Quota controls for cloud worker dispatches (Ghidra + JADX). Phase 0
     * emergency throttle to bound the AWS bill while the desktop CLI and
     * proper credits system are still in flight. {@code dailyCapPerUser}
     * caps how many worker runs one user can start per UTC day; null or
     * non-positive disables the gate entirely.
     */
    public record Workers(Integer dailyCapPerUser) {}

    /**
     * SES outbound email config. All three fields nullable so local dev
     * runs without AWS credentials — {@code EmailService} logs and
     * returns when {@code region} or {@code abuseTo} is blank.
     */
    public record Email(String region, String abuseFrom, String abuseTo) {}
}

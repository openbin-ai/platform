package ai.openapk.core.symbols.usages;

/**
 * Single row in {@code project_usages}. POJO, not an entity — the volume
 * (millions of rows per project) makes Hibernate's persistence context a
 * bottleneck; we insert/query via JdbcTemplate.
 *
 * @param kind one of "method", "ctor", "ref" — disambiguates {@code new Foo()}
 *             from {@code foo()} from {@code Foo::bar}.
 */
public record ProjectUsageRow(
        String name,
        String file,
        int line,
        String snippet,
        String enclosingMethod,
        boolean isSdk,
        String kind
) {}

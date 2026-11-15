package ai.openapk.core.publicread;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PublicStatsServiceTest {

    static class SteppingClock extends Clock {
        Instant now = Instant.parse("2026-11-08T12:00:00Z");
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @Test
    void cachesForOneMinuteThenRecomputes() {
        var jdbc = mock(JdbcTemplate.class);
        var calls = new AtomicInteger();
        when(jdbc.queryForObject(anyString(), eq(Long.class))).thenAnswer(inv -> (long) calls.incrementAndGet());
        when(jdbc.queryForObject(anyString(), eq(Long.class), any())).thenReturn(3L);
        var clock = new SteppingClock();
        var svc = new PublicStatsService(jdbc, clock);

        var first = svc.current();
        assertThat(first.online()).isEqualTo(3L);
        clock.now = clock.now.plus(Duration.ofSeconds(30));
        assertThat(svc.current()).isSameAs(first);

        clock.now = clock.now.plus(Duration.ofSeconds(31));
        var second = svc.current();
        assertThat(second).isNotSameAs(first);
        assertThat(second.computedAt()).isEqualTo(clock.now);
    }

    @Test
    void onlineWindowIsFiveMinutesBeforeNow() {
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Long.class))).thenReturn(7000L);
        when(jdbc.queryForObject(anyString(), eq(Long.class),
                eq(java.sql.Timestamp.from(Instant.parse("2026-11-08T11:55:00Z"))))).thenReturn(41L);
        var svc = new PublicStatsService(jdbc, new SteppingClock());

        var s = svc.current();
        assertThat(s.users()).isEqualTo(7000L);
        assertThat(s.online()).isEqualTo(41L);
        assertThat(s.publicReports()).isEqualTo(7000L);
    }
}

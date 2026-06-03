package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.Ioc;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure-static IoC extraction over decompiled source. No AI tokens spent here.
 * Caps unique values per type to avoid drowning the model in noise.
 */
@Component
public class IoCExtractor {

    private static final Pattern URL = Pattern.compile(
            "https?://[\\w._\\-/:?#\\[\\]@!$&'()*+,;=~%]+",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern IPV4 = Pattern.compile(
            "(?<![\\w.])((?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)(?![\\w.])"
    );
    private static final Pattern EMAIL = Pattern.compile(
            "[\\w.+\\-]+@[\\w\\-]+(?:\\.[\\w\\-]+)+"
    );
    private static final Pattern BASE64 = Pattern.compile(
            "(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])"
    );
    private static final Pattern HEX_BLOB = Pattern.compile(
            "(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])"
    );

    // Filter out IPs that are clearly not IoCs (loopback, link-local, broadcast).
    private static final Set<String> IP_NOISE = Set.of(
            "0.0.0.0", "127.0.0.1", "255.255.255.255",
            "1.0.0.0", "1.1.1.1" // these can be real IoCs too but are common samples
    );

    // Domain noise (Android framework + common dev infra). Filter URLs.
    private static final List<String> URL_NOISE_HOSTS = List.of(
            "schemas.android.com",
            "schemas.xmlsoap.org",
            "www.w3.org",
            "ns.adobe.com",
            "xmlpull.org",
            "java.sun.com",
            "javax.xml",
            "xml.apache.org"
    );

    private static final int MAX_PER_TYPE = 100;

    public List<Ioc> extract(List<String> sourceTexts) {
        Map<String, Map<String, Integer>> byType = new HashMap<>();
        byType.put("url", new HashMap<>());
        byType.put("ipv4", new HashMap<>());
        byType.put("email", new HashMap<>());
        byType.put("base64", new HashMap<>());
        byType.put("hex", new HashMap<>());

        for (String text : sourceTexts) {
            collect(byType.get("url"), URL, text, value -> URL_NOISE_HOSTS.stream().noneMatch(value::contains));
            collect(byType.get("ipv4"), IPV4, text, value -> !IP_NOISE.contains(value));
            collect(byType.get("email"), EMAIL, text, value -> true);
            collect(byType.get("base64"), BASE64, text, value -> value.length() <= 200);
            collect(byType.get("hex"), HEX_BLOB, text, value -> value.length() <= 128);
        }

        List<Ioc> out = new ArrayList<>();
        byType.forEach((type, counts) -> counts.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, Integer>>comparingInt(Map.Entry::getValue).reversed()
                        .thenComparing(Map.Entry::getKey))
                .limit(MAX_PER_TYPE)
                .forEach(e -> out.add(new Ioc(type, e.getKey(), e.getValue()))));
        return out;
    }

    private static void collect(Map<String, Integer> counts, Pattern p, String text, java.util.function.Predicate<String> keep) {
        var m = p.matcher(text);
        Set<String> seenInThisFile = new HashSet<>();
        while (m.find()) {
            String v = m.group();
            if (!keep.test(v)) continue;
            if (seenInThisFile.add(v)) {
                counts.merge(v, 1, Integer::sum);
            }
        }
    }
}

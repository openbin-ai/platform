package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.Ioc;
import ai.openapk.core.analysis.dto.SignatureHit;
import ai.openapk.core.analysis.dto.StaticDigest;
import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Service
public class StaticDigestService {

    private static final Logger log = LoggerFactory.getLogger(StaticDigestService.class);
    private static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";

    // Subset of Android dangerous permissions (developer.android.com/reference/android/Manifest.permission).
    private static final Set<String> DANGEROUS_PERMISSIONS = Set.of(
            "android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR",
            "android.permission.CAMERA",
            "android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS", "android.permission.GET_ACCOUNTS",
            "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION",
            "android.permission.ACCESS_BACKGROUND_LOCATION",
            "android.permission.RECORD_AUDIO",
            "android.permission.READ_PHONE_STATE", "android.permission.READ_PHONE_NUMBERS",
            "android.permission.CALL_PHONE", "android.permission.ANSWER_PHONE_CALLS",
            "android.permission.READ_CALL_LOG", "android.permission.WRITE_CALL_LOG",
            "android.permission.ADD_VOICEMAIL", "android.permission.USE_SIP",
            "android.permission.BODY_SENSORS", "android.permission.BODY_SENSORS_BACKGROUND",
            "android.permission.ACTIVITY_RECOGNITION",
            "android.permission.SEND_SMS", "android.permission.RECEIVE_SMS",
            "android.permission.READ_SMS", "android.permission.RECEIVE_WAP_PUSH", "android.permission.RECEIVE_MMS",
            "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE",
            "android.permission.MANAGE_EXTERNAL_STORAGE",
            "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_AUDIO", "android.permission.READ_MEDIA_VIDEO",
            "android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_ADVERTISE",
            "android.permission.POST_NOTIFICATIONS",
            "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.REQUEST_INSTALL_PACKAGES"
    );

    // Regex patterns per signature category. Tuned for both Java and smali source.
    private static final Map<String, Pattern> SIGNATURES = new LinkedHashMap<>();
    static {
        SIGNATURES.put("reflection", Pattern.compile(
                "Class\\.forName\\(|getDeclaredMethod\\(|getDeclaredField\\(|Method\\.invoke\\(|getMethod\\(|setAccessible\\("));
        SIGNATURES.put("crypto", Pattern.compile(
                "Cipher\\.getInstance|MessageDigest\\.getInstance|SecretKeySpec|KeyGenerator\\.getInstance|" +
                "\"AES/ECB|\"DES\"|\"DESede\"|\"MD5\"|\"SHA-1\"|\"RC4\""));
        // Hand-rolled string-obfuscation decoders. Catches classes that do
        // Base64.decode + XOR (or similar) to hide Intent actions / C2 hosts.
        // These deliberately avoid javax.crypto APIs so the "crypto" category
        // misses them. Patterns are loose because obfuscators vary spacing.
        SIGNATURES.put("obfuscation_decoder", Pattern.compile(
                "Base64\\.decode\\(" +
                "|\\^\\s*\\w+\\.charAt\\(" +
                "|charAt\\([^)]{1,30}\\)\\s*\\^" +
                "|\\[[^\\]]{1,20}\\]\\s*=\\s*\\(byte\\)\\s*\\([^)]*\\^"
        ));
        SIGNATURES.put("dynamic_loading", Pattern.compile(
                "DexClassLoader|PathClassLoader|InMemoryDexClassLoader|defineClass\\("));
        SIGNATURES.put("native_code", Pattern.compile(
                "System\\.loadLibrary|System\\.load\\(|Runtime\\.getRuntime\\(\\)\\.load"));
        SIGNATURES.put("network", Pattern.compile(
                "HttpURLConnection|OkHttpClient|HttpsURLConnection|Retrofit|WebSocket|java\\.net\\.Socket"));
        SIGNATURES.put("storage", Pattern.compile(
                "getSharedPreferences|openFileOutput|getExternalStorage|MODE_WORLD_READABLE|MODE_WORLD_WRITEABLE"));
        SIGNATURES.put("root_detection", Pattern.compile(
                "/system/xbin/su|/system/bin/su|RootBeer|com\\.noshufou\\.android\\.su|eu\\.chainfire|isDeviceRooted"));
        SIGNATURES.put("anti_debug", Pattern.compile(
                "Debug\\.isDebuggerConnected|android\\.os\\.Debug|ptrace|TracerPid"));
        SIGNATURES.put("ipc", Pattern.compile(
                "Intent\\.setFlags|FLAG_GRANT_READW?I?T?A?B?L?E?_URI_PERMISSION|sendBroadcast|registerReceiver"));
        SIGNATURES.put("shell", Pattern.compile(
                "Runtime\\.exec|ProcessBuilder|/system/bin/sh|/bin/sh"));
    }

    private static final int MAX_HITS_PER_CATEGORY = 30;
    private static final int MAX_SNIPPET_LEN = 140;
    // Cap total source text fed to IoC extractor to bound memory + CPU.
    private static final long MAX_TOTAL_SCAN_BYTES = 50L * 1024 * 1024; // 50MB

    private final ProjectStorage storage;
    private final IoCExtractor iocExtractor;

    public StaticDigestService(ProjectStorage storage, IoCExtractor iocExtractor) {
        this.storage = storage;
        this.iocExtractor = iocExtractor;
    }

    public StaticDigest compute(User user, Project project) throws IOException {
        Path src = storage.srcDir(user.getId(), project.getId()).normalize();

        ManifestInfo manifest = parseManifest(src);

        Map<String, List<SignatureHit>> hits = new LinkedHashMap<>();
        for (String cat : SIGNATURES.keySet()) hits.put(cat, new ArrayList<>());

        int codeFiles = 0;
        int totalFiles = 0;
        long scannedBytes = 0;
        List<String> textForIocs = new ArrayList<>();

        if (Files.exists(src)) {
            try (Stream<Path> walk = Files.walk(src)) {
                List<Path> all = walk.filter(Files::isRegularFile).toList();
                totalFiles = all.size();
                for (Path file : all) {
                    String name = file.getFileName().toString().toLowerCase();
                    if (!(name.endsWith(".java") || name.endsWith(".smali") || name.endsWith(".xml") || name.endsWith(".kt"))) {
                        continue;
                    }
                    codeFiles++;
                    if (scannedBytes >= MAX_TOTAL_SCAN_BYTES) continue;
                    try {
                        String content = Files.readString(file, StandardCharsets.UTF_8);
                        scannedBytes += content.length();
                        scanSignatures(file, src, content, hits);
                        textForIocs.add(content);
                    } catch (IOException e) {
                        log.debug("skip {}: {}", file, e.toString());
                    }
                }
            }
        }

        // Cap each category and sort by file path for determinism.
        for (var entry : hits.entrySet()) {
            List<SignatureHit> list = entry.getValue();
            list.sort(Comparator.comparing(SignatureHit::file).thenComparingInt(SignatureHit::line));
            if (list.size() > MAX_HITS_PER_CATEGORY) {
                entry.setValue(new ArrayList<>(list.subList(0, MAX_HITS_PER_CATEGORY)));
            }
        }

        List<Ioc> iocs = iocExtractor.extract(textForIocs);

        return new StaticDigest(
                manifest.packageName,
                manifest.minSdk,
                manifest.targetSdk,
                manifest.debuggable,
                manifest.cleartext,
                manifest.permissions,
                manifest.components,
                hits,
                iocs,
                codeFiles,
                totalFiles
        );
    }

    private void scanSignatures(Path file, Path src, String content, Map<String, List<SignatureHit>> hits) {
        String relPath = src.relativize(file).toString();
        String[] lines = content.split("\\R", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            for (var entry : SIGNATURES.entrySet()) {
                List<SignatureHit> bucket = hits.get(entry.getKey());
                if (bucket.size() >= MAX_HITS_PER_CATEGORY * 3) continue; // soft cap pre-final-cap
                if (entry.getValue().matcher(line).find()) {
                    String snippet = line.strip();
                    if (snippet.length() > MAX_SNIPPET_LEN) {
                        snippet = snippet.substring(0, MAX_SNIPPET_LEN) + "…";
                    }
                    bucket.add(new SignatureHit(relPath, i + 1, snippet));
                }
            }
        }
    }

    private record ManifestInfo(
            String packageName,
            Integer minSdk,
            Integer targetSdk,
            Boolean debuggable,
            Boolean cleartext,
            List<StaticDigest.Permission> permissions,
            List<StaticDigest.Component> components
    ) {}

    private ManifestInfo parseManifest(Path src) {
        Path[] candidates = new Path[] {
                src.resolve("resources").resolve("AndroidManifest.xml"),
                src.resolve("AndroidManifest.xml"),
        };
        for (Path manifest : candidates) {
            if (!Files.exists(manifest)) continue;
            try {
                var factory = DocumentBuilderFactory.newInstance();
                factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
                factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                factory.setXIncludeAware(false);
                factory.setExpandEntityReferences(false);
                var doc = factory.newDocumentBuilder().parse(manifest.toFile());
                Element root = doc.getDocumentElement();
                if (root == null || !"manifest".equals(root.getNodeName())) continue;

                String pkg = nullIfBlank(root.getAttribute("package"));
                Integer minSdk = null, targetSdk = null;
                Boolean debuggable = null, cleartext = null;

                NodeList usesSdk = root.getElementsByTagName("uses-sdk");
                if (usesSdk.getLength() > 0 && usesSdk.item(0) instanceof Element u) {
                    minSdk = parseIntOrNull(u.getAttributeNS(ANDROID_NS, "minSdkVersion"));
                    targetSdk = parseIntOrNull(u.getAttributeNS(ANDROID_NS, "targetSdkVersion"));
                }

                NodeList apps = root.getElementsByTagName("application");
                Element app = apps.getLength() > 0 && apps.item(0) instanceof Element ? (Element) apps.item(0) : null;
                if (app != null) {
                    debuggable = parseBoolOrNull(app.getAttributeNS(ANDROID_NS, "debuggable"));
                    cleartext = parseBoolOrNull(app.getAttributeNS(ANDROID_NS, "usesCleartextTraffic"));
                }

                List<StaticDigest.Permission> perms = new ArrayList<>();
                NodeList usesPerm = root.getElementsByTagName("uses-permission");
                for (int i = 0; i < usesPerm.getLength(); i++) {
                    if (usesPerm.item(i) instanceof Element e) {
                        String name = e.getAttributeNS(ANDROID_NS, "name");
                        if (!name.isBlank()) {
                            perms.add(new StaticDigest.Permission(name, DANGEROUS_PERMISSIONS.contains(name)));
                        }
                    }
                }

                List<StaticDigest.Component> components = new ArrayList<>();
                if (app != null) {
                    addComponents(app, "activity", components);
                    addComponents(app, "service", components);
                    addComponents(app, "receiver", components);
                    addComponents(app, "provider", components);
                }

                return new ManifestInfo(pkg, minSdk, targetSdk, debuggable, cleartext, perms, components);
            } catch (Exception e) {
                log.debug("manifest parse failed for {}: {}", manifest, e.toString());
            }
        }
        return new ManifestInfo(null, null, null, null, null, List.of(), List.of());
    }

    private void addComponents(Element app, String tag, List<StaticDigest.Component> out) {
        NodeList nodes = app.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            if (!(nodes.item(i) instanceof Element e)) continue;
            String name = e.getAttributeNS(ANDROID_NS, "name");
            boolean exported = parseBoolOrFalse(e.getAttributeNS(ANDROID_NS, "exported"));
            // Default-exported heuristic: a component with at least one intent-filter is exported on older SDKs
            // unless explicitly set false. SDK 31+ requires explicit. We'll report whatever the manifest says.
            String permission = nullIfBlank(e.getAttributeNS(ANDROID_NS, "permission"));

            List<String> intentFilters = new ArrayList<>();
            NodeList filters = e.getElementsByTagName("intent-filter");
            for (int j = 0; j < filters.getLength(); j++) {
                if (!(filters.item(j) instanceof Element f)) continue;
                NodeList actions = f.getElementsByTagName("action");
                for (int k = 0; k < actions.getLength(); k++) {
                    if (actions.item(k) instanceof Element a) {
                        String aname = a.getAttributeNS(ANDROID_NS, "name");
                        if (!aname.isBlank()) intentFilters.add(aname);
                    }
                }
                NodeList data = f.getElementsByTagName("data");
                for (int k = 0; k < data.getLength(); k++) {
                    if (data.item(k) instanceof Element d) {
                        String scheme = d.getAttributeNS(ANDROID_NS, "scheme");
                        String host = d.getAttributeNS(ANDROID_NS, "host");
                        if (!scheme.isBlank()) {
                            intentFilters.add("data: " + scheme + (host.isBlank() ? "" : "://" + host));
                        }
                    }
                }
            }
            out.add(new StaticDigest.Component(tag, name, exported, intentFilters, permission));
        }
    }

    private static String nullIfBlank(String s) { return s == null || s.isBlank() ? null : s; }
    private static Integer parseIntOrNull(String s) { try { return s == null || s.isBlank() ? null : Integer.parseInt(s); } catch (Exception e) { return null; } }
    private static Boolean parseBoolOrNull(String s) {
        if (s == null || s.isBlank()) return null;
        if (s.equalsIgnoreCase("true")) return true;
        if (s.equalsIgnoreCase("false")) return false;
        return null;
    }
    private static boolean parseBoolOrFalse(String s) { return s != null && s.equalsIgnoreCase("true"); }

    /** Walks the project source for an IoC-only pass (no manifest, no signatures). Cheap helper used by /ask. */
    public String loadFileTextBounded(User user, Project project, String relPath, int maxBytes) throws IOException {
        Path src = storage.srcDir(user.getId(), project.getId()).normalize();
        Path resolved = src.resolve(relPath).normalize();
        if (!resolved.startsWith(src)) throw new IllegalArgumentException("path escapes project root");
        if (!Files.isRegularFile(resolved)) throw new IOException("not a regular file: " + relPath);
        byte[] bytes;
        try (var in = Files.newInputStream(resolved)) {
            bytes = in.readNBytes(maxBytes);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    public boolean isFileLargerThan(User user, Project project, String relPath, long max) throws IOException {
        Path src = storage.srcDir(user.getId(), project.getId()).normalize();
        Path resolved = src.resolve(relPath).normalize();
        if (!resolved.startsWith(src)) throw new IllegalArgumentException("path escapes project root");
        return Files.size(resolved) > max;
    }
}

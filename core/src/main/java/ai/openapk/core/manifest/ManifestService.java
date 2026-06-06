package ai.openapk.core.manifest;

import ai.openapk.core.auth.User;
import ai.openapk.core.manifest.dto.AndroidManifestInfo;
import ai.openapk.core.manifest.dto.IntentFilter;
import ai.openapk.core.manifest.dto.ManifestComponent;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.symbols.SymbolService;
import ai.openapk.core.symbols.dto.Symbol;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Parses {@code AndroidManifest.xml} produced by JADX into a structured
 * view: package metadata, declared permissions, and the four kinds of
 * components (activities, services, receivers, providers) with their
 * intent filters and effective exported flag.
 *
 * <p>Components are cross-referenced against the {@link SymbolService}
 * index so the UI can jump directly from a manifest entry to the class
 * declaration.</p>
 *
 * <p>JADX places the manifest at {@code {srcDir}/resources/AndroidManifest.xml}.</p>
 */
@Service
public class ManifestService {

    private static final Logger log = LoggerFactory.getLogger(ManifestService.class);
    private static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";

    private final ProjectAccessGuard guard;
    private final ProjectStorage storage;
    private final SymbolService symbolService;

    public ManifestService(ProjectAccessGuard guard, ProjectStorage storage, SymbolService symbolService) {
        this.guard = guard;
        this.storage = storage;
        this.symbolService = symbolService;
    }

    @Transactional
    public AndroidManifestInfo load(User user, UUID projectId) {
        // VIEWER-OK: read the AndroidManifest.xml.
        Project project = guard.requireRead(user, projectId);
        Path manifest = storage.srcDir(project.getUser().getId(), projectId).resolve("resources").resolve("AndroidManifest.xml");
        if (!Files.isRegularFile(manifest)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "AndroidManifest.xml not found — run an analysis first to (re-)decompile the APK.");
        }

        Document doc;
        try (var in = Files.newInputStream(manifest)) {
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            // Lock down XXE on the off chance a malicious APK embeds an entity bomb.
            dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            dbf.setExpandEntityReferences(false);
            dbf.setNamespaceAware(true);
            DocumentBuilder db = dbf.newDocumentBuilder();
            doc = db.parse(in);
        } catch (ParserConfigurationException | SAXException | IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Failed to parse AndroidManifest.xml: " + e.getMessage(), e);
        }

        Element root = doc.getDocumentElement();
        String pkg = attr(root, null, "package");
        Integer versionCode = parseIntAttr(root, "versionCode");
        String versionName = attr(root, ANDROID_NS, "versionName");
        Integer minSdk = null, targetSdk = null;
        Element usesSdk = firstChild(root, "uses-sdk");
        if (usesSdk != null) {
            minSdk = parseIntAttr(usesSdk, "minSdkVersion");
            targetSdk = parseIntAttr(usesSdk, "targetSdkVersion");
        }

        List<String> permissions = collectNameAttrs(root, "uses-permission");
        List<String> definedPermissions = collectNameAttrs(root, "permission");

        // Build a snapshot of the symbol index so component lookups are cheap.
        var idx = symbolService.getOrBuild(user, projectId);

        Element app = firstChild(root, "application");
        ManifestComponent application = null;
        List<ManifestComponent> activities = new ArrayList<>();
        List<ManifestComponent> services = new ArrayList<>();
        List<ManifestComponent> receivers = new ArrayList<>();
        List<ManifestComponent> providers = new ArrayList<>();

        if (app != null) {
            application = buildComponent("application", app, pkg, idx);
            for (Element child : children(app)) {
                ManifestComponent c = switch (child.getLocalName()) {
                    case "activity", "activity-alias" -> buildComponent("activity", child, pkg, idx);
                    case "service" -> buildComponent("service", child, pkg, idx);
                    case "receiver" -> buildComponent("receiver", child, pkg, idx);
                    case "provider" -> buildComponent("provider", child, pkg, idx);
                    default -> null;
                };
                if (c == null) continue;
                switch (c.kind()) {
                    case "activity" -> activities.add(c);
                    case "service" -> services.add(c);
                    case "receiver" -> receivers.add(c);
                    case "provider" -> providers.add(c);
                }
            }
        }

        return new AndroidManifestInfo(
                pkg, versionCode, versionName, minSdk, targetSdk,
                permissions, definedPermissions,
                application, activities, services, receivers, providers
        );
    }

    private ManifestComponent buildComponent(String kind, Element e, String pkg, ai.openapk.core.symbols.dto.SymbolIndex idx) {
        String rawName = attr(e, ANDROID_NS, "name");
        String className = expandRelativeName(pkg, rawName);
        List<IntentFilter> filters = parseIntentFilters(e);

        boolean exportedExplicit = e.hasAttributeNS(ANDROID_NS, "exported");
        boolean exported = exportedExplicit
                ? "true".equalsIgnoreCase(attr(e, ANDROID_NS, "exported"))
                : !filters.isEmpty();

        boolean enabled = !"false".equalsIgnoreCase(attr(e, ANDROID_NS, "enabled"));
        String permission = attr(e, ANDROID_NS, "permission");
        List<String> authorities = "provider".equals(kind)
                ? splitCsv(attr(e, ANDROID_NS, "authorities"))
                : List.of();

        // Cross-ref with the symbol index: try the FQN's simple name first.
        String file = null;
        Integer line = null;
        if (!className.isEmpty()) {
            String simple = className.contains(".")
                    ? className.substring(className.lastIndexOf('.') + 1)
                    : className;
            for (Symbol s : idx.symbols()) {
                if (s.kind() != ai.openapk.core.symbols.dto.SymbolKind.CLASS) continue;
                if (!s.name().equals(simple)) continue;
                // Prefer a match whose package matches the FQN's package.
                String defFqn = (s.pkg() == null || s.pkg().isEmpty()) ? simple : s.pkg() + "." + simple;
                if (defFqn.equals(className)) {
                    file = s.file();
                    line = s.line();
                    break;
                }
                if (file == null) {
                    file = s.file();
                    line = s.line();
                }
            }
        }

        return new ManifestComponent(kind, className, exported, enabled, permission, filters, authorities, file, line);
    }

    private List<IntentFilter> parseIntentFilters(Element parent) {
        List<IntentFilter> out = new ArrayList<>();
        for (Element f : children(parent)) {
            if (!"intent-filter".equals(f.getLocalName())) continue;
            List<String> actions = new ArrayList<>();
            List<String> categories = new ArrayList<>();
            List<String> dataSchemes = new ArrayList<>();
            for (Element c : children(f)) {
                String name = attr(c, ANDROID_NS, "name");
                switch (c.getLocalName()) {
                    case "action" -> { if (!name.isEmpty()) actions.add(name); }
                    case "category" -> { if (!name.isEmpty()) categories.add(name); }
                    case "data" -> {
                        String scheme = attr(c, ANDROID_NS, "scheme");
                        String host = attr(c, ANDROID_NS, "host");
                        String mime = attr(c, ANDROID_NS, "mimeType");
                        if (!scheme.isEmpty()) dataSchemes.add(scheme + (host.isEmpty() ? "" : "://" + host));
                        else if (!mime.isEmpty()) dataSchemes.add(mime);
                    }
                    default -> { /* unknown child — ignore */ }
                }
            }
            Integer pri = parseIntAttr(f, "priority");
            out.add(new IntentFilter(actions, categories, dataSchemes, pri));
        }
        return out;
    }

    /** Android allows `.Foo` and `Foo` as shorthand for `{pkg}.Foo`. */
    private static String expandRelativeName(String pkg, String name) {
        if (name == null || name.isEmpty()) return "";
        if (name.startsWith(".")) return pkg + name;
        if (!name.contains(".") && pkg != null && !pkg.isEmpty()) return pkg + "." + name;
        return name;
    }

    private static List<String> collectNameAttrs(Element parent, String tagLocalName) {
        List<String> out = new ArrayList<>();
        for (Element c : children(parent)) {
            if (!tagLocalName.equals(c.getLocalName())) continue;
            String name = attr(c, ANDROID_NS, "name");
            if (!name.isEmpty()) out.add(name);
        }
        return out;
    }

    private static List<String> splitCsv(String s) {
        if (s == null || s.isEmpty()) return List.of();
        List<String> out = new ArrayList<>();
        for (String part : s.split(";")) {
            String t = part.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static Element firstChild(Element parent, String localName) {
        for (Element c : children(parent)) {
            if (localName.equals(c.getLocalName())) return c;
        }
        return null;
    }

    private static List<Element> children(Element parent) {
        List<Element> out = new ArrayList<>();
        NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            Node n = nl.item(i);
            if (n.getNodeType() == Node.ELEMENT_NODE) out.add((Element) n);
        }
        return out;
    }

    private static String attr(Element e, String ns, String name) {
        String v = ns == null ? e.getAttribute(name) : e.getAttributeNS(ns, name);
        return v == null ? "" : v;
    }

    private static Integer parseIntAttr(Element e, String localName) {
        String v = e.getAttributeNS(ANDROID_NS, localName);
        if (v == null || v.isEmpty()) return null;
        try { return Integer.parseInt(v); } catch (NumberFormatException ex) {
            log.debug("manifest non-numeric attr {}={}", localName, v);
            return null;
        }
    }
}

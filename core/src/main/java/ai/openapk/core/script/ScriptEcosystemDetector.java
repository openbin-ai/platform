package ai.openapk.core.script;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Sniffs a SCRIPT upload and picks which analyzer Lambda should chew on it.
 * Filename + magic bytes + a shallow peek into the archive — the Lambdas
 * themselves do not care which ecosystem they're running on, so the
 * dispatch decision has to happen here.
 *
 * <p>Defaults to {@link ScriptEcosystem#NPM} on any ambiguity — JS-1 has
 * been shipping for weeks and existing tests / fixtures assume that
 * fallback. Adding a third (or fourth) ecosystem later means adding more
 * marker filenames; the structure of the detector itself shouldn't change.
 */
@Component
public class ScriptEcosystemDetector {

    private static final Logger log = LoggerFactory.getLogger(ScriptEcosystemDetector.class);

    /** Cap on how many archive entries we look at before giving up + falling back. */
    private static final int MAX_PEEK_ENTRIES = 100;

    /**
     * @return the ecosystem to route the upload to. Never throws on a
     *         malformed archive — degrades to NPM so the caller can let
     *         the worker emit a real parse-error finding instead of us
     *         pre-empting it with a generic 400.
     */
    public ScriptEcosystem detect(MultipartFile file) {
        String filename = file.getOriginalFilename();
        String lower = filename == null ? "" : filename.toLowerCase(Locale.ROOT);

        // Filename-only fast paths — covers single-file uploads + wheels
        // (which are always .whl, never tar.gz).
        if (lower.endsWith(".whl")) return ScriptEcosystem.PYPI;
        if (lower.endsWith(".py")) return ScriptEcosystem.PYPI;
        if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".ts")) {
            return ScriptEcosystem.NPM;
        }
        // Shell scripts — no archive sniffing needed for these. PowerShell
        // .ps1/.psm1 + POSIX .sh/.bash/.zsh all route to shell-worker.
        if (lower.endsWith(".ps1") || lower.endsWith(".psm1") ||
                lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) {
            return ScriptEcosystem.SHELL;
        }

        try {
            byte[] magic;
            try (InputStream peek = file.getInputStream()) {
                magic = peek.readNBytes(4);
            }
            if (magic.length < 2) return ScriptEcosystem.NPM;
            int b0 = magic[0] & 0xff;
            int b1 = magic[1] & 0xff;

            if (b0 == 0x1f && b1 == 0x8b) {
                try (InputStream raw = file.getInputStream();
                     GZIPInputStream gz = new GZIPInputStream(raw)) {
                    return peekTar(gz);
                }
            }
            if (b0 == 0x50 && b1 == 0x4b) {
                try (InputStream raw = file.getInputStream();
                     ZipInputStream zip = new ZipInputStream(raw)) {
                    return peekZip(zip);
                }
            }
        } catch (IOException e) {
            log.warn("ecosystem detect failed for {}: {} — falling back to NPM", filename, e.toString());
        }
        return ScriptEcosystem.NPM;
    }

    /**
     * Walk tar headers (512-byte blocks). Each header's first 100 bytes
     * are the NUL-terminated filename; size lives at offset 124 in octal.
     * Stops at the first marker filename we recognize, or after
     * MAX_PEEK_ENTRIES.
     */
    private ScriptEcosystem peekTar(InputStream in) throws IOException {
        byte[] header = new byte[512];
        for (int i = 0; i < MAX_PEEK_ENTRIES; i++) {
            int read = in.readNBytes(header, 0, 512);
            if (read < 512) break;
            String name = readCString(header, 0, 100);
            if (name.isEmpty()) break;
            ScriptEcosystem hint = classifyEntry(name);
            if (hint != null) return hint;
            long size = parseOctal(header, 124, 12);
            long padded = ((size + 511) / 512) * 512;
            long skipped = 0;
            while (skipped < padded) {
                long more = in.skip(padded - skipped);
                if (more <= 0) {
                    // Best-effort drain — some streams refuse skip() past
                    // their buffer. Read-and-discard the remainder.
                    byte[] dump = new byte[(int) Math.min(8192, padded - skipped)];
                    int n = in.read(dump);
                    if (n < 0) return ScriptEcosystem.NPM;
                    skipped += n;
                } else {
                    skipped += more;
                }
            }
        }
        return ScriptEcosystem.NPM;
    }

    private ScriptEcosystem peekZip(ZipInputStream zip) throws IOException {
        ZipEntry entry;
        int seen = 0;
        while (seen < MAX_PEEK_ENTRIES && (entry = zip.getNextEntry()) != null) {
            String name = entry.getName();
            // Wheel layout marker: any *.dist-info/ entry is PyPI.
            if (name.contains(".dist-info/")) return ScriptEcosystem.PYPI;
            ScriptEcosystem hint = classifyEntry(name);
            if (hint != null) return hint;
            seen++;
        }
        return ScriptEcosystem.NPM;
    }

    /**
     * Classify a single archive entry by its basename. Returns null when
     * the entry doesn't carry an ecosystem signal — the caller keeps
     * walking.
     */
    private static ScriptEcosystem classifyEntry(String entryName) {
        String basename = entryName;
        int slash = entryName.lastIndexOf('/');
        if (slash >= 0 && slash < entryName.length() - 1) {
            basename = entryName.substring(slash + 1);
        }
        return switch (basename) {
            case "package.json" -> ScriptEcosystem.NPM;
            case "setup.py", "pyproject.toml", "PKG-INFO", "setup.cfg" -> ScriptEcosystem.PYPI;
            default -> null;
        };
    }

    private static String readCString(byte[] buf, int off, int max) {
        int end = off;
        int limit = Math.min(buf.length, off + max);
        while (end < limit && buf[end] != 0) end++;
        return new String(buf, off, end - off, StandardCharsets.UTF_8);
    }

    private static long parseOctal(byte[] buf, int off, int len) {
        long val = 0;
        for (int i = off; i < off + len; i++) {
            int b = buf[i] & 0xff;
            if (b == 0 || b == ' ') continue;
            if (b < '0' || b > '7') return 0;
            val = (val << 3) + (b - '0');
        }
        return val;
    }
}

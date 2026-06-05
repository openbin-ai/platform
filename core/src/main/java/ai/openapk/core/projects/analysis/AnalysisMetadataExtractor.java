package ai.openapk.core.projects.analysis;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.util.zip.GZIPInputStream;

/**
 * Streams just the {@code metadata} object out of a Ghidra-worker JSON
 * blob, ignoring the {@code functions}/{@code strings}/{@code data_symbols}
 * arrays that dominate the payload size. This is the heart of the
 * "backend never holds the whole JSON in memory" guarantee: a
 * {@link JsonParser} walks the gzip stream token-by-token, so a 200MB
 * input parses with a few KB of resident memory.
 *
 * <p>Why not use {@link tools.jackson.databind.JsonNode}? Because building
 * a JsonNode tree of a 200MB JSON allocates ~1-2GB of heap (boxed
 * objects, character buffers). That's the whole problem we're solving.
 */
@Component
public class AnalysisMetadataExtractor {

    private static final Logger log = LoggerFactory.getLogger(AnalysisMetadataExtractor.class);

    private final ObjectMapper mapper;

    public AnalysisMetadataExtractor(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * Streams {@code gzipped} through Jackson and returns the metadata
     * fields we persist on the project row. Closes the stream when
     * done. Returns a record with nulls when the field is absent
     * (legacy or partial worker output).
     *
     * <p>Also returns the array lengths for {@code functions}, {@code strings},
     * {@code imports}, {@code exports}, {@code entry_points},
     * {@code tls_callbacks}, {@code data_symbols}, {@code memory_blocks}
     * so the listing UI can show counts without re-downloading the body.
     */
    public ExtractedMetadata extract(InputStream gzipped) {
        try (var gz = new GZIPInputStream(new BufferedInputStream(gzipped));
             var parser = mapper.createParser(gz)) {

            String arch = null, executableFormat = null, compiler = null,
                   languageId = null, imageBase = null;
            int functionCount = 0, stringCount = 0, importCount = 0,
                exportCount = 0, entryPointCount = 0, tlsCallbackCount = 0,
                dataSymbolCount = 0, memoryBlockCount = 0;

            // Top-level must be an object.
            JsonToken t = parser.nextToken();
            if (t != JsonToken.START_OBJECT) {
                throw new IllegalStateException("worker JSON does not start with an object (got " + t + ")");
            }

            while ((t = parser.nextToken()) != JsonToken.END_OBJECT) {
                if (t != JsonToken.PROPERTY_NAME) continue;
                String field = parser.currentName();
                parser.nextToken(); // advance to the value
                switch (field) {
                    case "metadata" -> {
                        // Walk metadata's properties one-by-one — no tree build.
                        if (parser.currentToken() != JsonToken.START_OBJECT) {
                            parser.skipChildren();
                            break;
                        }
                        while (parser.nextToken() != JsonToken.END_OBJECT) {
                            if (parser.currentToken() != JsonToken.PROPERTY_NAME) continue;
                            String mf = parser.currentName();
                            parser.nextToken();
                            switch (mf) {
                                case "arch" -> arch = stringOrNull(parser);
                                case "executable_format" -> executableFormat = stringOrNull(parser);
                                case "compiler" -> compiler = stringOrNull(parser);
                                case "language" -> languageId = stringOrNull(parser);
                                case "image_base" -> imageBase = stringOrNull(parser);
                                default -> parser.skipChildren();
                            }
                        }
                    }
                    case "functions" -> functionCount = countArray(parser);
                    case "strings" -> stringCount = countArray(parser);
                    case "imports" -> importCount = countArray(parser);
                    case "exports" -> exportCount = countArray(parser);
                    case "entry_points" -> entryPointCount = countArray(parser);
                    case "tls_callbacks" -> tlsCallbackCount = countArray(parser);
                    case "data_symbols" -> dataSymbolCount = countArray(parser);
                    case "memory_blocks" -> memoryBlockCount = countArray(parser);
                    case "error" -> {
                        String err = stringOrNull(parser);
                        throw new IllegalStateException("worker JSON contains error: " + err);
                    }
                    default -> parser.skipChildren();
                }
            }
            log.info("extracted metadata: arch={} fmt={} fns={} data={} blocks={}",
                    arch, executableFormat, functionCount, dataSymbolCount, memoryBlockCount);
            return new ExtractedMetadata(
                    arch, executableFormat, compiler, languageId, imageBase,
                    functionCount, stringCount, importCount, exportCount,
                    entryPointCount, tlsCallbackCount, dataSymbolCount, memoryBlockCount
            );
        } catch (RuntimeException re) {
            throw re;
        } catch (Exception e) {
            throw new RuntimeException("Failed to stream-parse worker JSON: " + e.getMessage(), e);
        }
    }

    /**
     * Walk an array's elements via skipChildren so we never materialize
     * any element — only count. Cheap on a 50k-function array.
     */
    private static int countArray(JsonParser parser) throws Exception {
        if (parser.currentToken() != JsonToken.START_ARRAY) {
            // Not the expected type — skip its children and report 0.
            parser.skipChildren();
            return 0;
        }
        int n = 0;
        while (parser.nextToken() != JsonToken.END_ARRAY) {
            parser.skipChildren();
            n++;
        }
        return n;
    }

    private static String stringOrNull(JsonParser parser) throws Exception {
        if (parser.currentToken() == JsonToken.VALUE_NULL) return null;
        if (parser.currentToken() == JsonToken.VALUE_STRING) {
            String s = parser.getString();
            return s != null && !s.isBlank() ? s : null;
        }
        // Unexpected non-string value — skip and report null.
        parser.skipChildren();
        return null;
    }

    public record ExtractedMetadata(
            String arch,
            String executableFormat,
            String compiler,
            String languageId,
            String imageBase,
            int functionCount,
            int stringCount,
            int importCount,
            int exportCount,
            int entryPointCount,
            int tlsCallbackCount,
            int dataSymbolCount,
            int memoryBlockCount
    ) {}
}

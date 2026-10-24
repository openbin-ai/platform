package ai.openapk.core.ctf;

import ai.openapk.core.config.OpenApkProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The fs backend path and the filename rules. S3 is exercised in deployment. */
class CtfBinaryStoreTest {

    @TempDir Path dir;

    @SuppressWarnings("unchecked")
    private CtfBinaryStore fsStore() {
        OpenApkProperties props = mock(OpenApkProperties.class);
        when(props.storage()).thenReturn(new OpenApkProperties.Storage("fs", null, null, null));
        when(props.workspace()).thenReturn(new OpenApkProperties.Workspace(dir.toString()));
        ObjectProvider<S3Client> s3 = mock(ObjectProvider.class);
        ObjectProvider<S3Presigner> presigner = mock(ObjectProvider.class);
        return new CtfBinaryStore(props, s3, presigner);
    }

    @Test
    void storesMovesAndDeletesUnderWorkspace() throws Exception {
        CtfBinaryStore store = fsStore();
        assertFalse(store.isS3());
        UUID id = UUID.randomUUID();
        Path tmp = Files.createTempFile(dir, "up", ".bin");
        Files.write(tmp, new byte[] {1, 2, 3});

        store.store(id, "crackme.elf", tmp);
        Path local = store.localPath(id, "crackme.elf");
        assertTrue(Files.isRegularFile(local));
        assertFalse(Files.exists(tmp), "temp file is moved, not copied");
        assertEquals(dir.resolve("ctf").resolve(id.toString()).resolve("crackme.elf"), local);
        assertTrue(store.presign(id, "crackme.elf", Duration.ofMinutes(1)).isEmpty());

        store.delete(id, "crackme.elf");
        assertFalse(Files.exists(local));
        store.delete(id, null); // tolerated
    }

    @Test
    void safeFilename() {
        assertEquals("crackme.elf", CtfBinaryStore.safeFilename("/tmp/../crackme.elf"));
        assertEquals("crack_me_v2.bin", CtfBinaryStore.safeFilename("C:\\Users\\x\\crack me v2.bin"));
        assertEquals("hidden", CtfBinaryStore.safeFilename("..hidden"));
        assertEquals("challenge.bin", CtfBinaryStore.safeFilename(""));
        assertEquals("challenge.bin", CtfBinaryStore.safeFilename(null));
        assertEquals(120, CtfBinaryStore.safeFilename("a".repeat(300) + ".elf").length());
    }
}

-- One JSON doc per project caching the result of the JNI bridge scan:
--   loader call sites (System.loadLibrary / System.load / Runtime.loadLibrary),
--   native method declarations, and the .so functions they were matched to.
-- Built lazily on first Native tab open; rebuilt on Rescan or after a new
-- .so finishes analysis.

ALTER TABLE projects
    ADD COLUMN jni_bridge_jsonb JSONB;

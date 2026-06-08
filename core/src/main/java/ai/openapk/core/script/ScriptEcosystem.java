package ai.openapk.core.script;

/**
 * Which static analyzer Lambda should chew on a SCRIPT upload. Decided at
 * upload time by {@link ScriptEcosystemDetector} so the rest of the
 * pipeline can stay ecosystem-agnostic.
 */
public enum ScriptEcosystem {
    /** npm tarballs (.tgz / .tar.gz with package.json), .zip exports, loose .js / .ts. */
    NPM,
    /** PyPI sdists (.tar.gz with setup.py / pyproject.toml), wheels (.whl), loose .py. */
    PYPI,
    /** Loose PowerShell (.ps1 / .psm1) and POSIX shell (.sh / .bash / .zsh) scripts. */
    SHELL
}

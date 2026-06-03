package ai.openapk.core.jnibridge.dto;

/**
 * One Java method declared with the {@code native} modifier, plus the JNI
 * function it was matched to in one of the project's .so files (if any).
 *
 * @param file            project-relative path of the .java file
 * @param line            1-based line number of the declaration
 * @param className       short class name (innermost enclosing class)
 * @param packageName     fully-qualified package, "" if default
 * @param methodName      Java method identifier
 * @param signature       trimmed declaration line for display
 * @param expectedJniName computed JNI symbol — Java_<package_underscored>_<class>_<method>
 * @param matchedLibPath  project-relative .so path where {@code expectedJniName} was
 *                        found, null if no analyzed lib contains it
 * @param matchedAddress  Ghidra address of the matched function (immutable
 *                        identity used by the click-to-jump nav), null when unmatched
 */
public record NativeMethodDecl(
        String file,
        int line,
        String className,
        String packageName,
        String methodName,
        String signature,
        String expectedJniName,
        String matchedLibPath,
        String matchedAddress
) {}

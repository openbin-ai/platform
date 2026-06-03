package ai.openapk.core.projects.dto;

import java.util.List;

public record FileNode(
        String name,
        String path,
        String type,
        Long size,
        List<FileNode> children
) {
    public static FileNode dir(String name, String path, List<FileNode> children) {
        return new FileNode(name, path, "dir", null, children);
    }

    public static FileNode file(String name, String path, long size) {
        return new FileNode(name, path, "file", size, null);
    }
}

package ai.openapk.core.crypto.dto;

import java.util.List;

/**
 * One step of a CyberChef recipe. {@code op} is the operation name as CyberChef
 * spells it (e.g. "From Base64", "XOR"). {@code args} is the positional argument
 * list — values can be strings, booleans, numbers, or maps (CyberChef option
 * objects like {@code {"option":"UTF8","string":"UTF-8"}}). Jackson serializes
 * the list as-is; the frontend turns it into CyberChef's URL-fragment syntax.
 */
public record CyberChefOp(String op, List<Object> args) {}

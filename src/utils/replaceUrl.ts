import path from "node:path";

export default function replaceUrl(url: string): string {
    if (typeof url !== "string" || !url.trim()) return "";
    const input = url.trim();
    if (input.startsWith("data:")) return input;

    let cleanedPath = "";
    try {
        cleanedPath = new URL(input, "http://toonflow.local").pathname;
    } catch (e) {
        // 如果不是有效 URL，则直接使用原字符串，并去掉查询参数和 hash
        cleanedPath = input.split(/[?#]/)[0];
    }

    // 防止路径穿越：对路径进行规范化后，确保不含上溯分量
    // 使用 posix 规范化（保持 / 分隔符），去除所有 .. 和 .
    let normalized = path.posix.normalize(cleanedPath.replace(/\\/g, "/"));

    // 规范化后若路径以 ../ 开头或等于 .. 则说明发生了路径穿越，拒绝并返回空字符串
    if (normalized.startsWith("../") || normalized === "..") {
        return "";
    }

    normalized = normalized.replace(/^\/+/, "");
    while (normalized === "oss" || normalized.startsWith("oss/") || normalized === "smallImage" || normalized.startsWith("smallImage/")) {
        normalized = normalized.replace(/^(?:oss|smallImage)\/?/, "");
    }

    return normalized;
}

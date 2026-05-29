import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const plugintRoot = u.getPath(["plugin"]);

  const entries = await fg("**/manifest.json", {
    cwd: plugintRoot.replace(/\\/g, "/"),
    onlyFiles: true,
  });
  console.log("%c Line:13 🍓 entries", "background:#7f2b82", entries);

  // 🔥 关键修复：统一正斜杠 /，无反斜杠、无双斜杠
  const allPaths = entries.map((i) => {
    // 1. 用 path.join 保证路径正确
    // 2. 统一把反斜杠 \ 换成正斜杠 /
    return path.join("/plugin", i).replace(/\\/g, "/");
  });
  res.status(200).send(success(allPaths));
});

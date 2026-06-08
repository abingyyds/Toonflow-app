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
  const allPlugin = [];
  console.log("%c Line:13 🍯 entries", "background:#b03734", entries);

  for (const item of entries) {
    const content = await fs.readFile(path.join(plugintRoot, item), "utf-8");
    const data = JSON.parse(content);
    allPlugin.push({ ...data, url: `/plugin/${data.id}` });
  }

  res.status(200).send(success(allPlugin));
});

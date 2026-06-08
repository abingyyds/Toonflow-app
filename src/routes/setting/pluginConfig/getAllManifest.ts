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

  const allPaths = entries.map((i) => {
    return path.join("/plugin", i).replace(/\\/g, "/");
  });
  res.status(200).send(success(allPaths));
});

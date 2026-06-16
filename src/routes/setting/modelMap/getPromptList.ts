import express from "express";
import { success } from "@/lib/responseFormat";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
import { getCurrentUserId } from "@/utils/requestContext";
import { getGlobalModelPromptRoot, getModelPromptRootForUser } from "@/utils/userConfig";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const globalRoot = getGlobalModelPromptRoot();
  const userId = getCurrentUserId();
  const userRoot = getModelPromptRootForUser(userId);

  const globalEntries = await fg(["image/**/*.md", "video/**/*.md"], {
    cwd: globalRoot.replace(/\\/g, "/"),
    onlyFiles: true,
  });

  const userEntries = userId
    ? await fs
        .mkdir(userRoot, { recursive: true })
        .then(() =>
          fg(["image/**/*.md", "video/**/*.md"], {
            cwd: userRoot.replace(/\\/g, "/"),
            onlyFiles: true,
          }),
        )
    : [];

  const readEntry = async (root: string, entry: string, scope: "global" | "user") => {
    const fullPath = path.join(root, entry);
    const content = await fs.readFile(fullPath, "utf-8");
    const name = path.basename(entry, ".md");
    const type = entry.includes("/") ? entry.split("/")[0] : "";
    const storedPath = scope === "user" && userId ? path.join("users", String(userId), entry).replace(/\\/g, "/") : entry;
    return { path: storedPath, name, type, data: content, scope };
  };

  const globalResult = await Promise.all(globalEntries.map((entry) => readEntry(globalRoot, entry, "global")));
  const userResult = await Promise.all(userEntries.map((entry) => readEntry(userRoot, entry, "user")));
  const resultByTypeAndName = new Map<string, Awaited<ReturnType<typeof readEntry>>>();
  for (const item of globalResult) resultByTypeAndName.set(`${item.type}/${item.name}`, item);
  for (const item of userResult) resultByTypeAndName.set(`${item.type}/${item.name}`, item);
  const result = [...resultByTypeAndName.values()];

  res.status(200).send(success(result));
});

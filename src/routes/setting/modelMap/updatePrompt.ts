import express from "express";
import { error, success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
import { getModelPromptRootForUser } from "@/utils/userConfig";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string().min(1),
    data: z.string(),
    type: z.enum(["image", "video"]),
  }),
  async (req, res) => {
    const { name, data, type } = req.body;
    if (path.basename(name) !== name) {
      return res.status(400).send(error("非法文件名"));
    }

    const modelPromptRoot = getModelPromptRootForUser();
    const filePath = path.join(modelPromptRoot, type, `${name}.md`);

    // 路径隧穿检测
    const resolvedRoot = path.resolve(modelPromptRoot, type);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
      return res.status(400).send(error("非法路径"));
    }

    await fs.mkdir(path.dirname(resolvedFile), { recursive: true });
    await fs.writeFile(resolvedFile, data, "utf-8");
    res.status(200).send(success("更新成功"));
  },
);

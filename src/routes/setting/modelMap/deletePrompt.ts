import express from "express";
import { error, success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
import { getCurrentUserId } from "@/utils/requestContext";
import { getModelPromptRootForUser } from "@/utils/userConfig";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    path: z.string(),
  }),
  async (req, res) => {
    const { path: filePath } = req.body;
    const userId = getCurrentUserId();
    const prefix = userId ? `users/${userId}/` : "";
    const normalizedPath = filePath.replace(/\\/g, "/");

    if (userId && !normalizedPath.startsWith(prefix)) {
      return res.status(403).send(error("无权删除全局或其他用户的提示词模板"));
    }

    const modelPromptRoot = getModelPromptRootForUser(userId);
    const relativePath = userId ? normalizedPath.slice(prefix.length) : normalizedPath;
    if (!relativePath.startsWith("image/") && !relativePath.startsWith("video/")) {
      return res.status(400).send(error("非法路径"));
    }

    // 路径隧穿检测
    const resolvedRoot = path.resolve(modelPromptRoot);
    const resolvedFile = path.resolve(modelPromptRoot, relativePath);
    if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
      return res.status(400).send(error("非法路径"));
    }

    // 文件不存在则报错
    try {
      await fs.access(resolvedFile);
    } catch {
      return res.status(404).send(error("文件不存在"));
    }

    await fs.unlink(resolvedFile);
    if (userId) {
      await u.db("o_userModelPrompt").where({ userId, path: normalizedPath }).delete();
    }
    res.status(200).send(success("删除成功"));
  },
);

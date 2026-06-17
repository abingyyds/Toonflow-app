import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { getModelPromptFullPath, isUserModelPromptPath, upsertUserModelPrompt } from "@/utils/userConfig";
import fs from "fs/promises";
import pathUtil from "path";
import { toInternalVendorId } from "@/utils/vendorVisibility";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    vendorId: z.string(),
    model: z.string(),
    path: z.string(),
    fileName: z.string(),
  }),
  async (req, res) => {
    const { vendorId, model, path, fileName } = req.body;
    const internalVendorId = toInternalVendorId(vendorId);
    const userId = getCurrentUserId();
    const normalizedPath = pathUtil.normalize(path).replace(/\\/g, "/");
    if (normalizedPath.startsWith("../") || pathUtil.isAbsolute(normalizedPath)) {
      return res.status(400).send(error("非法提示词模板路径"));
    }
    if (userId && isUserModelPromptPath(normalizedPath) && !normalizedPath.startsWith(`users/${userId}/`)) {
      return res.status(403).send(error("无权绑定其他用户的提示词模板"));
    }
    try {
      await fs.access(getModelPromptFullPath(normalizedPath));
    } catch {
      return res.status(404).send(error("提示词模板不存在"));
    }

    if (userId) {
      await upsertUserModelPrompt(userId, internalVendorId, model, { fileName, path: normalizedPath });
    } else {
      const data = await u.db("o_modelPrompt").where("model", model).andWhere("vendorId", internalVendorId).select("*").first();
      if (data) {
        await u.db("o_modelPrompt").where("model", model).andWhere("vendorId", internalVendorId).update({ fileName, path: normalizedPath });
      } else {
        await u.db("o_modelPrompt").insert({ vendorId: internalVendorId, model, path: normalizedPath, fileName });
      }
    }
    res.status(200).send(success("绑定成功"));
  },
);

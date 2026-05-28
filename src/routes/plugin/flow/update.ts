import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 更新图片工作流
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    flowData: z.string().optional(),
  }),
  async (req, res) => {
    const { id, ...rest } = req.body;
    const updateData: Record<string, any> = {};
    for (const k of Object.keys(rest)) {
      if (rest[k] !== undefined) updateData[k] = rest[k];
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(200).send(error("没有可更新的字段"));
    }
    const affected = await u.db("o_imageFlow").where({ id }).update(updateData);
    if (!affected) return res.status(200).send(error("工作流不存在"));
    res.status(200).send(success(null, "更新工作流成功"));
  },
);

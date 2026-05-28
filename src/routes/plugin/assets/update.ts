import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 更新资产
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string().optional(),
    type: z.string().optional(),
    describe: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),
    assetsId: z.number().optional().nullable(),
    scriptId: z.number().optional().nullable(),
    flowId: z.number().optional().nullable(),
    imageId: z.number().optional().nullable(),
    promptState: z.string().optional().nullable(),
    audioBindState: z.number().optional().nullable(),
    promptErrorReason: z.string().optional().nullable(),
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
    const affected = await u.db("o_assets").where({ id }).update(updateData);
    if (!affected) return res.status(200).send(error("资产不存在"));
    res.status(200).send(success(null, "更新资产成功"));
  },
);

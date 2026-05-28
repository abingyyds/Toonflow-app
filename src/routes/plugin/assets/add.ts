import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增资产
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    type: z.string(),
    projectId: z.number(),
    describe: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),
    assetsId: z.number().optional().nullable(),
    scriptId: z.number().optional().nullable(),
    flowId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { name, type, projectId, describe, prompt, remark, assetsId, scriptId, flowId } = req.body;
    const [id] = await u.db("o_assets").insert({
      name,
      type,
      projectId,
      describe,
      prompt,
      remark,
      assetsId,
      scriptId,
      flowId,
      startTime: Date.now(),
    });
    res.status(200).send(success({ id }, "新增资产成功"));
  },
);

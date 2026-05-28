import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增图片工作流
export default router.post(
  "/",
  validateFields({
    id: z.number().optional(),
    flowData: z.string(),
  }),
  async (req, res) => {
    const { flowData, id } = req.body;
    const [newId] = await u.db("o_imageFlow").insert({
      id: id,
      flowData,
    });
    res.status(200).send(success({ id: newId }, "新增工作流成功"));
  },
);

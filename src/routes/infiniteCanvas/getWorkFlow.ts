import express from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

// 获取项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const flowData = await u.db("o_flowProject").where("id", id).select("*").first();
    if (!flowData || !flowData?.workFlow) return res.status(200).send();
    const workFlow = JSON.parse(flowData?.workFlow);
    res.status(200).send(success(workFlow));
  },
);

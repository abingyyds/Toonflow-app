import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 查询单个图片工作流（自动格式化 flowData）
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const item = await u.db("o_imageFlow").where({ id }).first();
    if (!item) {
      return res.status(200).send(success(null));
    }

    let flowData: any = item.flowData;
    if (typeof flowData === "string") {
      try {
        flowData = JSON.parse(flowData);
      } catch {
        // 兼容历史脏数据，解析失败时返回原始字符串
      }
    }

    return res.status(200).send(success({ ...item, flowData }));
  },
);

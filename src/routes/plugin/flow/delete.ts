import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除图片工作流（支持单个或批量）
export default router.post(
  "/",
  validateFields({
    id: z.union([z.number(), z.array(z.number())]),
  }),
  async (req, res) => {
    const raw = req.body.id;
    const ids: number[] = Array.isArray(raw) ? raw : [raw];
    if (ids.length === 0) {
      return res.status(200).send(success(null, "删除工作流成功"));
    }

    await u.db("o_imageFlow").whereIn("id", ids).delete();
    res.status(200).send(success(null, "删除工作流成功"));
  },
);

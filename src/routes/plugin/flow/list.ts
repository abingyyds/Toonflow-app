import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 查询图片工作流列表（支持按 id 查询、分页）
export default router.post(
  "/",
  validateFields({
    id: z.number().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  }),
  async (req, res) => {
    const { id, page = 1, limit = 20 } = req.body;
    const offset = (page - 1) * limit;

    const buildBase = () => {
      let q = u.db("o_imageFlow").where((qb) => {
        if (id !== undefined) qb.andWhere("id", id);
      });
      return q;
    };

    const data = await buildBase().select("*").offset(offset).limit(limit);
    const totalRow = (await buildBase().count<{ total: number }>("id as total").first()) as any;

    res.status(200).send(success({ data, total: totalRow?.total ?? 0, page, limit }));
  },
);

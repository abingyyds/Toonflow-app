import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
const router = express.Router();

// 获取单个项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const userId = getCurrentUserId();

    const query = u.db("o_project").where("id", id).select("*");
    if (userId) query.andWhere("userId", userId);
    const data = await query;

    res.status(200).send(success(data));
  }
);

import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    name: z.string(),
  }),
  async (req, res) => {
    const { name, intro } = req.body;

    await u.db("o_flowProject").insert({
      id: Date.now(),
      name,
      intro,
      createTime: Date.now(),
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);

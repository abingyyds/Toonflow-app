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
    id: z.number(),
    name: z.string(),
    intro: z.string(),
  }),
  async (req, res) => {
    const { id, name, intro } = req.body;

    await u.db("o_flowProject").where("id", id).update({
      name,
      intro,
    });

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);

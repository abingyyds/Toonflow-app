import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    //删除项目
    await u.db("o_flowProject").where("id", id).delete();

    res.status(200).send(success({ message: "删除项目成功" }));
  },
);

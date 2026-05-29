import express from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    data: z.any(),
  }),
  async (req, res) => {
    const { id, data } = req.body;
    await u
      .db("o_flowProject")
      .where("id", id)
      .update({
        workFlow: JSON.stringify(data),
      });
    res.status(200).send(success(null, "更新工作流成功"));
  },
);

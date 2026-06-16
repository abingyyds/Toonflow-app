import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { upsertUserPrompt } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id, data } = req.body;
    const userId = getCurrentUserId();
    if (userId) {
      await upsertUserPrompt(userId, id, { useData: data });
    } else {
      await u.db("o_prompt").where("id", id).update({
        useData: data,
      });
    }
    res.status(200).send(success(123));
  },
);

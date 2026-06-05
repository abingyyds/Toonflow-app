import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { formatSubrouterError, selectSubrouterModel } from "@/utils/subrouter";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    modelName: z.string().min(1),
    targets: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const userId = getCurrentUserId();
    if (!userId) return res.status(401).send({ message: "未提供token" });
    try {
      await selectSubrouterModel(userId, req.body.modelName, req.body.targets || []);
      res.status(200).send(success("模型已设置到当前用户"));
    } catch (err) {
      res.status(400).send(error(formatSubrouterError(err)));
    }
  },
);

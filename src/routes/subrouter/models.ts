import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { formatSubrouterError, getStoredSubrouterAccount, refreshStoredModels } from "@/utils/subrouter";

const router = express.Router();

function parseModels(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default router.post(
  "/",
  validateFields({
    provider: z.enum(["subrouterai", "sub2api"]).optional(),
    baseUrl: z.string().optional(),
    refresh: z.boolean().optional(),
  }),
  async (req, res) => {
    const userId = getCurrentUserId();
    if (!userId) return res.status(401).send({ message: "未提供token" });
    try {
      const models = req.body.refresh
        ? await refreshStoredModels(userId, req.body.provider, req.body.baseUrl)
        : parseModels((await getStoredSubrouterAccount(userId, req.body.provider, req.body.baseUrl))?.models);
      res.status(200).send(success(models));
    } catch (err) {
      res.status(400).send(error(formatSubrouterError(err)));
    }
  },
);

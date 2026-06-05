import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { upsertUserAgentDeploy } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
  }),
  async (req, res) => {
    const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
    const userId = getCurrentUserId();
    if (userId) {
      const base = await u.db("o_agentDeploy").where({ id }).first();
      if (!base?.key) return res.status(400).send(error("未找到 Agent 配置"));
      await upsertUserAgentDeploy(userId, {
        ...base,
        key: base.key,
        agentKey: base.key,
        name,
        model,
        modelName,
        vendorId,
        desc,
        temperature,
        maxOutputTokens,
      });
    } else {
      await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    }
    res.status(200).send(success("配置成功"));
  },
);

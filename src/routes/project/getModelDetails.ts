import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getEffectiveAgentDeploy } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    key: z.enum(["scriptAgent", "productionAgent"]),
  }),
  async (req, res) => {
    const { key } = req.body;
    const data = await getEffectiveAgentDeploy(key);
    if (!data?.modelName) return res.status(200).send(success(null));

    const [id, modelName] = data.modelName.split(/:(.+)/);
    if (!id || !modelName) return res.status(200).send(success(null));

    const models = await u.vendor.getModelList(id);
    const model = models.find((m) => m.modelName === modelName);
    if (!model) return res.status(200).send(success(null));
    res.status(200).send(success(model));
  },
);

import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { getCurrentUserId } from "@/utils/requestContext";
import { getEffectiveVendorConfig, upsertUserVendorConfig } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    modelName: z.string(),
  }),
  async (req, res) => {
    const { id, modelName } = req.body;
    const userId = getCurrentUserId();

    const models = userId ? await getEffectiveVendorConfig(id) : await u.db("o_vendorConfig").where("id", id).first();
    if (models?.models) {
      const existingModels = JSON.parse(models.models);
      if (!existingModels.some((model: any) => model.modelName === modelName)) {
        return res.status(400).send(error("基本模型不允许删除"));
      }
      const updatedModels = existingModels.filter((model: any) => model.modelName !== modelName);
      if (userId) {
        await upsertUserVendorConfig(userId, id, {
          inputValues: JSON.parse(models.inputValues ?? "{}"),
          models: updatedModels,
          enable: models.enable ?? 0,
        });
      } else {
        await u
          .db("o_vendorConfig")
          .where("id", id)
          .update({
            models: JSON.stringify(updatedModels),
          });
      }
    }
    res.status(200).send(success("更新成功"));
  },
);

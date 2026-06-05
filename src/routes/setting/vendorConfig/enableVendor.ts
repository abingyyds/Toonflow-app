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
    enable: z.number(),
  }),
  async (req, res) => {
    const { id, enable } = req.body;
    const userId = getCurrentUserId();
    if (userId) {
      const effective = await getEffectiveVendorConfig(id);
      await upsertUserVendorConfig(userId, id, {
        inputValues: JSON.parse(effective?.inputValues ?? "{}"),
        models: JSON.parse(effective?.models ?? "[]"),
        enable,
      });
    } else {
      await u.db("o_vendorConfig").where("id", id).update({ enable });
    }
    res.status(200).send(success("更新成功"));
  },
);

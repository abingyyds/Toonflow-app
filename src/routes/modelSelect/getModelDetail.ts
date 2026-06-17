import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { toInternalVendorId } from "@/utils/vendorVisibility";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    modelId: z.string(),
  }),
  async (req, res) => {
    const { modelId } = req.body;
    const [id, name] = modelId.split(/:(.+)/);
    const models = await u.vendor.getModelList(toInternalVendorId(id));
    const findData = models.find((i: any) => i.modelName == name);
    res.status(200).send(success(findData));
  },
);

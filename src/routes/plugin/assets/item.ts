import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 查询单个资产详情
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;

    const item = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.id", id)
      .select("o_assets.*", "o_image.filePath", "o_image.state")
      .first();

    if (!item) {
      return res.status(200).send(success(null));
    }

    if (item.filePath) item.src = await u.oss.getFileUrl(item.filePath);
    else item.src = null;

    return res.status(200).send(success(item));
  },
);

import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 更新资产
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    describe: z.string(),
    remark: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
    projectId: z.number().optional().nullable(),
    type: z.string().optional().nullable(),
    base64: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { id, name, describe, remark, prompt, projectId, type, base64 } = req.body;
    const updateData: Record<string, unknown> = {
      name,
      describe,
      remark,
      prompt,
    };

    if (base64) {
      if (!projectId || !type || !["role", "scene", "tool"].includes(type)) {
        return res.status(400).send(error("上传图片缺少项目或资产类型"));
      }

      const imageType = type as "role" | "scene" | "tool";
      const matches = base64.match(/^data:image\/\w+;base64,(.+)$/);
      const realBase64 = matches ? matches[1] : base64;
      const savePath = `/${projectId}/${imageType}/${uuidv4()}.png`;
      await u.oss.writeFile(savePath, Buffer.from(realBase64, "base64"));
      const [imageId] = await u.db("o_image").insert({
        assetsId: id,
        filePath: savePath,
        type: imageType,
        state: "已完成",
      });
      updateData.imageId = imageId;
    }

    await u.db("o_assets").where({ id }).update(updateData);
    res.status(200).send(success({ message: "更新资产成功" }));
  },
);

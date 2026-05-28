import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除资产（支持单个或批量；同时清理关联图片、子资产、剧本关联）
export default router.post(
  "/",
  validateFields({
    id: z.union([z.number(), z.array(z.number())]),
  }),
  async (req, res) => {
    const raw = req.body.id;
    const ids: number[] = Array.isArray(raw) ? raw : [raw];
    if (ids.length === 0) {
      return res.status(200).send(success(null, "删除资产成功"));
    }

    // 清理资产关联图片
    const images = await u.db("o_image").whereIn("assetsId", ids).select();
    await Promise.all(
      images.map((i) =>
        i.filePath
          ? u.oss.deleteFile(i.filePath).catch((e: any) => {
              if (e?.code !== "ENOENT") throw e;
            })
          : Promise.resolve(),
      ),
    );
    const imageIds = images.map((i) => i.id).filter(Boolean);
    if (imageIds.length > 0) {
      await u.db("o_assets").whereIn("imageId", imageIds).update({ imageId: null });
    }
    await u.db("o_image").whereIn("assetsId", ids).delete();

    // 删除子资产
    await u.db("o_assets").whereIn("assetsId", ids).delete();
    // 删除剧本-资产关联
    await u.db("o_scriptAssets").whereIn("assetId", ids).delete();
    // 删除分镜-资产关联
    await u.db("o_assets2Storyboard").whereIn("assetId", ids).delete();
    // 删除资产本身
    await u.db("o_assets").whereIn("id", ids).delete();

    res.status(200).send(success(null, "删除资产成功"));
  },
);

import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 查询资产列表（支持按项目/类型/名称模糊查询、分页）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().optional(),
    type: z.string().optional(),
    name: z.string().optional(),
    scriptId: z.number().optional(),
    assetsId: z.number().optional().nullable(),
    page: z.number().optional(),
    limit: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, type, name, scriptId, assetsId, page = 1, limit = 20 } = req.body;
    const offset = (page - 1) * limit;

    const buildBase = () => {
      let q = u
        .db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .where((qb) => {
          if (projectId !== undefined) qb.andWhere("o_assets.projectId", projectId);
          if (type !== undefined) qb.andWhere("o_assets.type", type);
          if (scriptId !== undefined) qb.andWhere("o_assets.scriptId", scriptId);
          if (assetsId !== undefined) {
            if (assetsId === null) qb.whereNull("o_assets.assetsId");
            else qb.andWhere("o_assets.assetsId", assetsId);
          }
          if (name) qb.andWhere("o_assets.name", "like", `%${name}%`);
        });
      return q;
    };

    const data = await buildBase()
      .select("o_assets.*", "o_image.filePath", "o_image.state")
      .offset(offset)
      .limit(limit);

    const totalRow = (await buildBase().count<{ total: number }>("o_assets.id as total").first()) as any;

    res.status(200).send(success({ data, total: totalRow?.total ?? 0, page, limit }));
  },
);

import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import isPathInside from "is-path-inside";
import p from "path";
import fs from "fs";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    const { id } = req.body;

    const pluginRoot = u.getPath(["plugin"]);
    const pluginDir = p.resolve(pluginRoot, id);
    if (!isPathInside(pluginDir, pluginRoot)) {
      return res.status(400).send(error("无效的路径"));
    }

    if (!fs.existsSync(pluginDir)) {
      return res.status(400).send(error(`插件 ${id} 不存在`));
    }

    try {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      res.status(200).send(success(null, "插件删除成功"));
    } catch (e: any) {
      return res.status(400).send(error(e.message || "插件删除失败"));
    }
  },
);

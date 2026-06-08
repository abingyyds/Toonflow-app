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
    id: z.string().min(1, "id 不能为空"),
    filePath: z.string().min(1, "filePath 不能为空"),
  }),
  async (req, res) => {
    const { id, filePath } = req.body;

    const pluginRoot = u.getPath(["plugin"]);
    const pluginDir = p.resolve(pluginRoot, id);

    if (!isPathInside(pluginDir, pluginRoot) && pluginDir !== pluginRoot) {
      return res.status(400).send(error("无效的插件 id"));
    }

    if (!fs.existsSync(pluginDir)) {
      return res.status(400).send(error(`插件 ${id} 不存在`));
    }

    const targetFile = p.resolve(pluginDir, filePath);

    if (!isPathInside(targetFile, pluginDir) && targetFile !== pluginDir) {
      return res.status(400).send(error("无效的文件路径：检测到路径穿越攻击"));
    }

    if (!fs.existsSync(targetFile)) {
      return res.status(400).send(error(`文件不存在: ${filePath}`));
    }

    const stat = fs.statSync(targetFile);

    if (!stat.isFile()) {
      return res.status(400).send(error(`路径不是文件: ${filePath}`));
    }

    try {
      const content = fs.readFileSync(targetFile, "utf-8");
      return res.status(200).send(success({ content }));
    } catch (e: any) {
      return res.status(500).send(error(`读取文件失败: ${e.message}`));
    }
  },
);

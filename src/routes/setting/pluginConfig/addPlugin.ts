import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import fs from "fs";
import fg from "fast-glob";
import path from "path";
import compressing from "compressing";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    base64Data: z.string().optional(),
    link: z.string().optional(),
  }),
  async (req, res) => {
    const { base64Data, link } = req.body;
    if (!base64Data && !link) return res.status(400).send(error("参数错误"));

    let zipBuffer: Buffer;

    if (link) {
      // 从链接获取内容，可能为二进制压缩包或 base64 文本
      const response = await fetch(link);
      if (!response.ok) {
        return res.status(400).send(error(`获取链接失败: ${response.status} ${response.statusText}`));
      }
      const arrayBuffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);

      // 尝试判断是否为 base64 文本
      const textContent = rawBuffer.toString("utf-8").trim();
      // 匹配 data:...;base64,... 格式
      const base64DataMatch = textContent.match(/^(?:data:[^;]*;)?base64,([A-Za-z0-9+/=]+)$/);
      if (base64DataMatch) {
        zipBuffer = Buffer.from(base64DataMatch[1], "base64");
      } else if (/^[A-Za-z0-9+/=]+$/.test(textContent) && textContent.length > 100) {
        // 纯 base64 字符串（较长时判定为 base64）
        zipBuffer = Buffer.from(textContent, "base64");
      } else {
        // 二进制压缩包
        zipBuffer = rawBuffer;
      }
    } else if (base64Data) {
      // 解析 base64 数据
      const base64Match = base64Data.match(/base64,([A-Za-z0-9+/=]+)/);
      if (!base64Match) {
        return res.status(400).send(error("无效的 base64 数据"));
      }
      zipBuffer = Buffer.from(base64Match[1], "base64");
    } else {
      return res.status(400).send(error("参数错误"));
    }

    // 写入临时目录
    const tempDir = u.getPath(["temp", "plugin", u.uuid()]);
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, "plugin.zip");
    fs.writeFileSync(zipPath, zipBuffer);

    try {
      // 解压
      await compressing.zip.uncompress(zipPath, tempDir);

      // 查找 manifest.json
      const manifestFiles = await fg("**/manifest.json", {
        cwd: tempDir.replace(/\\/g, "/"),
        onlyFiles: true,
      });

      if (manifestFiles.length === 0) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.status(400).send(error("压缩包中未找到 manifest.json，每个插件包必须包含 manifest.json"));
      }

      // 读取 manifest.json
      const manifestPath = path.join(tempDir, manifestFiles[0]);
      const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      if (!manifestContent.id) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.status(400).send(error("manifest.json 中缺少 id 字段"));
      }

      const pluginId: string = manifestContent.id;

      // 校验 pluginId：不允许路径穿越和特殊字符
      if (pluginId.includes("..") || pluginId.includes("/") || pluginId.includes("\\")) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.status(400).send(error("manifest.json 中 id 包含非法字符（路径穿越），仅允许字母、数字、下划线、连字符、点号"));
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(pluginId)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.status(400).send(error("manifest.json 中 id 包含非法字符，仅允许字母、数字、下划线、连字符、点号"));
      }

      const pluginDir = u.getPath(["plugin", pluginId]);

      // 检查是否已存在
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.status(400).send(error(`插件 ${pluginId} 已存在，请使用更新接口`));
      }

      // manifest.json 所在目录即为插件根目录
      const sourceDir = path.dirname(manifestPath);

      // 复制到 data/plugin/{id}/
      fs.cpSync(sourceDir, pluginDir, { recursive: true });

      // 清理临时目录
      fs.rmSync(tempDir, { recursive: true, force: true });

      res.status(200).send(success(manifestContent, "插件安装成功"));
    } catch (e: any) {
      // 出错时清理临时目录
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      return res.status(400).send(error(e.message || "插件安装失败"));
    }
  },
);

import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
import { v4 as uuidv4 } from "uuid";
import isPathInside from "is-path-inside";
import p from "path";
import axios from "axios";
const router = express.Router();

async function urlToBase64(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("/oss/")) {
    return await u.oss.getImageBase64(u.replaceUrl(imageUrl).replace("/smallImage", ""));
  }
  imageUrl = await u.oss.getFileUrl(u.replaceUrl(imageUrl));
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    references: z.array(z.string()),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    ratio: z.string(),
    audio: z.boolean().optional(),
    filePath: z.string(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, references, model, ratio, duration, resolution, audio, mode, filePath } = req.body;
    //对 filePath 进行越权检测 例如../这种 使用 isPathInside

    const basePath = u.getPath("oss");

    // 规范化用户路径：去除前导 / 或 \，统一分隔符为系统分隔符
    const normalizedPath = filePath
      .replace(/^[/\\]+/, "")
      .split("/")
      .join(p.sep);
    const resolvedFilePath = p.join(basePath, normalizedPath);

    if (!isPathInside(resolvedFilePath, basePath)) {
      return res.status(400).send(error("非法的文件路径"));
    }

    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }
    const videoPath = filePath; //视频保存路径

    /**
     * 根据文件路径/URL/dataURI 判断媒体类型
     */
    function detectMediaType(src: string): "image" | "audio" | "video" {
      // data URI：从 MIME 类型判断
      if (src.startsWith("data:")) {
        const mime = src.slice(5, src.indexOf(";"));
        if (mime.startsWith("video/")) return "video";
        if (mime.startsWith("audio/")) return "audio";
        return "image";
      }
      // 根据扩展名判断
      const ext = p.extname(src).toLowerCase();
      const videoExts = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".3gp"];
      const audioExts = [".mp3", ".wav", ".ogg", ".aac", ".m4a", ".flac", ".wma", ".opus", ".wav"];
      if (videoExts.includes(ext)) return "video";
      if (audioExts.includes(ext)) return "audio";
      return "image";
    }

    const base64 = await Promise.all(
      references.map(async (item: string) => {
        if (!item) return null;
        const mediaType = detectMediaType(item);
        // 视频不做转 base64 处理，直接透传原始值
        if (mediaType === "video") {
          return { base64: item, type: "video" as const };
        }
        const base64 = item.startsWith("data:") ? item : await urlToBase64(item);
        return { base64, type: mediaType };
      }),
    );

    const relatedObjects = {
      projectId,
      scriptId,
      type: "视频",
    };

    const aiVideo = await u.Ai.Video(model).run(
      {
        prompt,
        referenceList: base64.filter(Boolean) as ReferenceList[],
        mode: modeData.length > 0 ? modeData : mode,
        duration,
        aspectRatio: ratio || "16:9",
        resolution,
        audio,
      },
      {
        projectId,
        taskClass: "视频生成",
        describe: "根据提示词生成视频",
        relatedObjects: JSON.stringify(relatedObjects),
      },
    );

    await aiVideo.save(videoPath);
    const url = await u.oss.getFileUrl(videoPath);
    return res.status(200).send(success({ url }));
  },
);

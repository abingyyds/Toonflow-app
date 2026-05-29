import express from "express";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success, error } from "@/lib/responseFormat";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.enum(["get", "write", "delete"]).default("get"),
    path: z.string(),
    data: z.string().optional(),
  }),
  async (req, res) => {
    const { type, path, data } = req.body as { type: "get" | "write" | "delete"; path: string; data?: string };
    try {
      if (type === "get") {
        const fileData = await u.oss.getFile(path);
        return res.status(200).send(success({ data: fileData.toString("base64") }));
      } else if (type === "write") {
        if (!data) return res.status(400).send(error("写入内容不能为空"));
        const buf = /^data:[^;]+;base64,/.test(data)
          ? Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64")
          : Buffer.from(data, "utf8");
        await u.oss.writeFile(path, buf);
        return res.status(200).send(success(null, "写入成功"));
      } else if (type === "delete") {
        await u.oss.deleteFile(path);
        return res.status(200).send(success(null, "删除成功"));
      }
    } catch (e: any) {
      return res.status(400).send(error(e?.message ?? "操作失败"));
    }
  },
);

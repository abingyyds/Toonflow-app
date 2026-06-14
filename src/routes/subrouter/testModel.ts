import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { formatSubrouterError, getStoredSubrouterAccount } from "@/utils/subrouter";
import u from "@/utils";

const router = express.Router();

interface StoredModel {
  modelName?: string;
  type?: string;
}

function parseModels(value: unknown): StoredModel[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

export default router.post(
  "/",
  validateFields({
    modelName: z.string().min(1),
    prompt: z.string().optional(),
  }),
  async (req, res) => {
    const userId = getCurrentUserId();
    if (!userId) return res.status(401).send({ message: "未提供token" });

    const account = await getStoredSubrouterAccount(userId);
    if (!account) return res.status(400).send(error("未绑定内置智能路由账户"));

    const modelName = String(req.body.modelName).includes(":") ? String(req.body.modelName).split(/:(.+)/)[1] : String(req.body.modelName);
    const model = parseModels(account.models).find((item) => item.modelName === modelName);
    if (!model) return res.status(400).send(error("当前账号模型列表中未找到该模型，请刷新模型后重试"));
    if (model.type !== "text") {
      return res.status(200).send(
        success({
          available: true,
          checked: false,
          modelName,
          message: "模型在当前账号列表中；非文本模型不在设置页发起生成测试",
        }),
      );
    }

    const started = Date.now();
    try {
      const result = await u.Ai.Text(`subrouter:${modelName}`).invoke({
        prompt: req.body.prompt || "请只回复 OK",
        temperature: 0,
        maxOutputTokens: 16,
      });
      const output = String(result.text || "").trim();
      if (!output) return res.status(500).send(error("模型未返回内容"));
      res.status(200).send(
        success({
          available: true,
          checked: true,
          modelName,
          latencyMs: Date.now() - started,
          output: output.slice(0, 200),
        }),
      );
    } catch (err) {
      res.status(500).send(
        error(formatSubrouterError(err), {
          available: false,
          checked: true,
          modelName,
          latencyMs: Date.now() - started,
        }),
      );
    }
  },
);

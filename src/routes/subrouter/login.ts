import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { formatSubrouterError, loginAndPrepareSubrouter, SubrouterProvider, toPublicSubrouterAccount } from "@/utils/subrouter";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    provider: z.string().min(1),
    baseUrl: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  async (req, res) => {
    const provider = normalizeLoginProvider(req.body.provider);
    if (!provider) return res.status(400).send(error("模型账号登录方式不可用"));
    try {
      const result = await loginAndPrepareSubrouter({ ...req.body, provider });
      res.status(200).send(
        success(
          {
            token: result.token,
            name: result.toonflowUser.name,
            id: result.toonflowUser.id,
            account: toPublicSubrouterAccount(result.account),
            models: result.models,
            modelsSource: result.modelsSource,
            defaultTextModel: result.defaultTextModel,
            notice: result.notice,
          },
          "模型账号登录成功",
        ),
      );
    } catch (err) {
      res.status(400).send(error(formatSubrouterError(err)));
    }
  },
);

function normalizeLoginProvider(value: unknown): SubrouterProvider | undefined {
  return value === "subrouterai" || value === "sub2api" ? value : undefined;
}

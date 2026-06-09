import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { formatSubrouterError, loginAndPrepareSubrouter } from "@/utils/subrouter";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    provider: z.enum(["subrouterai", "sub2api"]),
    baseUrl: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  async (req, res) => {
    try {
      const result = await loginAndPrepareSubrouter(req.body);
      res.status(200).send(
        success(
          {
            token: result.token,
            name: result.toonflowUser.name,
            id: result.toonflowUser.id,
            account: {
              provider: result.account.provider,
              baseUrl: result.account.baseUrl,
              username: result.account.username,
              email: result.account.email,
              displayName: result.account.displayName,
              distributorId: result.account.distributorId,
              distributorSlug: result.account.distributorSlug,
              distributorName: result.account.distributorName,
              apiKeyReady: Boolean(result.account.apiKey),
            },
            models: result.models,
            modelsSource: result.modelsSource,
            defaultTextModel: result.defaultTextModel,
            notice: result.notice,
          },
          "内置智能路由登录成功",
        ),
      );
    } catch (err) {
      res.status(400).send(error(formatSubrouterError(err)));
    }
  },
);

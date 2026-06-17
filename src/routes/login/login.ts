import express from "express";
import u from "@/utils";
import jwt from "jsonwebtoken";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import { formatSubrouterError, loginAndPrepareSubrouter, loginWithDefaultSubrouterProviders, SubrouterProvider, toPublicSubrouterAccount } from "@/utils/subrouter";
const router = express.Router();

export function setToken(payload: string | object, expiresIn: string | number, secret: string): string {
  if (!payload || typeof secret !== "string" || !secret) {
    throw new Error("参数不合法");
  }
  return (jwt.sign as any)(payload, secret, { expiresIn });
}

// 登录
export default router.post(
  "/",
  validateFields({
    username: z.string(),
    password: z.string(),
    provider: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
  async (req, res) => {
    const { username, password, provider, baseUrl } = req.body;

    if (provider && baseUrl) {
      const loginProvider = normalizeLoginProvider(provider);
      if (!loginProvider) return res.status(400).send(error("模型账号登录方式不可用"));
      try {
        const result = await loginAndPrepareSubrouter({ provider: loginProvider, baseUrl, username, password });
        return res.status(200).send(
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
        return res.status(400).send(error(formatSubrouterError(err)));
      }
    }

    const data = await u.db("o_user").where("name", "=", username).first();

    if (data && data!.password == password && data!.name == username) {
      const tokenData = await u.db("o_setting").where("key", "tokenKey").first();
      if (!tokenData) return res.status(400).send(error("未找到tokenKey"));
      const token = setToken(
        {
          id: data!.id,
          name: data!.name,
        },
        "180Days",
        tokenData?.value as string,
      );

      return res.status(200).send(success({ token: "Bearer " + token, name: data!.name, id: data!.id }, "登录成功"));
    }

    try {
      const result = await loginWithDefaultSubrouterProviders(username, password);
      if (result) {
        return res.status(200).send(
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
      }
    } catch (err) {
      return res.status(400).send(error(formatSubrouterError(err)));
    }

    return res.status(400).send(error("用户名或密码错误"));
  },
);

function normalizeLoginProvider(value: unknown): SubrouterProvider | undefined {
  return value === "subrouterai" || value === "sub2api" ? value : undefined;
}

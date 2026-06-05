import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getCurrentUserId } from "@/utils/requestContext";
import { getEffectiveVendorConfig, upsertUserAgentDeploy, upsertUserVendorConfig } from "@/utils/userConfig";

const router = express.Router();

async function setAgent(userId: number | undefined, agentKey: string, model: string, modelName: string) {
  if (!userId) {
    await u.db("o_agentDeploy").where("key", agentKey).update({
      model,
      modelName,
      vendorId: "toonflow",
    });
    return;
  }

  const base = await u.db("o_agentDeploy").where("key", agentKey).first();
  if (!base) return;
  await upsertUserAgentDeploy(userId, {
    ...base,
    key: agentKey,
    agentKey,
    model,
    modelName,
    vendorId: "toonflow",
  });
}

export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
  }),
  async (req, res) => {
    const { key } = req.body;
    const userId = getCurrentUserId();
    const vendorConfigData = userId ? await getEffectiveVendorConfig("toonflow") : await u.db("o_vendorConfig").where("id", "toonflow").first();
    if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
    if (!vendorConfigData.inputValues) return res.status(500).send(error("未找到模型配置数据"));

    const inputValue = JSON.parse(vendorConfigData.inputValues);
    const oldKey = inputValue.apiKey;
    inputValue.apiKey = key;

    const saveInputValues = async (nextValues: Record<string, string>) => {
      if (userId) {
        await upsertUserVendorConfig(userId, "toonflow", {
          inputValues: nextValues,
          models: JSON.parse(vendorConfigData.models ?? "[]"),
          enable: vendorConfigData.enable ?? 1,
        });
        return;
      }
      await u.db("o_vendorConfig").where("id", "toonflow").update({
        inputValues: JSON.stringify(nextValues),
      });
    };

    await saveInputValues(inputValue);

    try {
      const resText = await u.Ai.Text("toonflow:claude-haiku-4-5-20251001").invoke({
        prompt: "1+1等于几？,请直接回答2，不要解释",
      });
      if (!resText.text) return res.status(400).send(error("模型未返回结果"));

      await setAgent(userId, "scriptAgent", "claude-sonnet-4-6", "toonflow:claude-sonnet-4-6");
      await setAgent(userId, "productionAgent", "claude-sonnet-4-6", "toonflow:claude-sonnet-4-6");
      await setAgent(userId, "universalAi", "claude-haiku-4-5", "toonflow:claude-haiku-4-5-20251001");
      res.status(200).send(success("一键填入成功"));
    } catch (err) {
      console.error(err);
      inputValue.apiKey = oldKey || "";
      await saveInputValues(inputValue);
      res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);

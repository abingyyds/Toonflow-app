import express from "express";
import { success } from "@/lib/responseFormat";
import { getCurrentUser, getCurrentUserId } from "@/utils/requestContext";
import { getUserSetting, getEffectiveAgentDeployList, AgentDeployRow } from "@/utils/userConfig";
import { getStoredSubrouterAccount } from "@/utils/subrouter";

const router = express.Router();

type ModelType = "text" | "image" | "video" | "other";

interface StoredModel {
  name?: string;
  modelName?: string;
  type?: ModelType | string;
  think?: boolean;
}

const DEFAULT_TARGETS = new Set(["scriptAgent", "productionAgent", "universalAi"]);

function parseModels(value: unknown): StoredModel[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function normalizeModelType(value: unknown): ModelType {
  return value === "text" || value === "image" || value === "video" ? value : "other";
}

function countModelsByType(models: StoredModel[]) {
  return models.reduce(
    (acc, model) => {
      acc[normalizeModelType(model.type)] += 1;
      return acc;
    },
    { text: 0, image: 0, video: 0, other: 0 },
  );
}

function splitModelName(modelName?: string | null) {
  if (!modelName) return { vendorId: "", model: "" };
  const [vendorId, model] = modelName.split(/:(.+)/);
  return { vendorId: vendorId || "", model: model || "" };
}

function summarizeAgents(rows: AgentDeployRow[], models: StoredModel[]) {
  const modelNames = new Set(models.map((model) => model.modelName).filter(Boolean));
  return rows
    .filter((row) => DEFAULT_TARGETS.has(row.key || row.agentKey || ""))
    .map((row) => {
      const key = row.key || row.agentKey || "";
      const parsed = splitModelName(row.modelName);
      return {
        key,
        name: row.name || key,
        desc: row.desc || "",
        model: row.model || parsed.model,
        modelName: row.modelName || "",
        vendorId: row.vendorId || parsed.vendorId,
        usingSubrouter: (row.vendorId || parsed.vendorId) === "subrouter",
        available: (row.vendorId || parsed.vendorId) === "subrouter" ? modelNames.has(row.model || parsed.model) : null,
      };
    });
}

function pickSelectedTextModel(agents: ReturnType<typeof summarizeAgents>) {
  const selected = agents.find((agent) => agent.key === "scriptAgent" && agent.usingSubrouter && agent.model);
  if (selected) return selected.model;
  return agents.find((agent) => agent.usingSubrouter && agent.model)?.model || "";
}

export default router.post("/", async (req, res) => {
  const user = getCurrentUser();
  const userId = getCurrentUserId();
  if (!userId) return res.status(401).send({ message: "未提供token" });

  const account = await getStoredSubrouterAccount(userId, req.body?.provider, req.body?.baseUrl);
  const models = parseModels(account?.models);
  const modelStats = countModelsByType(models);
  const agents = summarizeAgents(await getEffectiveAgentDeployList(userId), models);
  const selectedTextModel = pickSelectedTextModel(agents);
  const diagnostics = [
    !account ? "未绑定内置智能路由账户" : "",
    account && !account.apiKey ? "自动 API Key 未生成" : "",
    account && models.length === 0 ? "当前账号没有可用模型，请刷新或检查订阅/分站上架" : "",
    account && modelStats.text === 0 ? "未发现文本模型，Agent 暂不能使用内置智能路由" : "",
    account && modelStats.text > 0 && !selectedTextModel ? "尚未为当前用户选择 Agent 文本模型" : "",
  ].filter(Boolean);

  res.status(200).send(
    success({
      user,
      connected: Boolean(account),
      account: account
        ? {
            provider: account.provider,
            baseUrl: account.baseUrl,
            username: account.username,
            email: account.email,
            displayName: account.displayName,
            distributorId: account.distributorId,
            distributorSlug: account.distributorSlug,
            distributorName: account.distributorName,
            apiKeyReady: Boolean(account.apiKey),
            updatedTime: (account as any).updatedTime,
          }
        : null,
      models,
      modelStats,
      selectedTextModel,
      agentUseMode: await getUserSetting("agentUseMode", "0"),
      agents,
      diagnostics,
    }),
  );
});

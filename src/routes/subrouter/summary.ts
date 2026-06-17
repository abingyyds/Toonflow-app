import express from "express";
import { success } from "@/lib/responseFormat";
import { getCurrentUser, getCurrentUserId } from "@/utils/requestContext";
import { getUserSetting, getEffectiveAgentDeployList, AgentDeployRow } from "@/utils/userConfig";
import { getStoredSubrouterAccount, toPublicSubrouterAccount } from "@/utils/subrouter";
import { INTERNAL_ROUTER_VENDOR_ID, toPublicModelId, toPublicVendorId } from "@/utils/vendorVisibility";

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
      const effectiveVendorId = row.vendorId || parsed.vendorId;
      return {
        key,
        name: row.name || key,
        desc: row.desc || "",
        model: row.model || parsed.model,
        modelName: toPublicModelId(row.modelName || ""),
        vendorId: toPublicVendorId(effectiveVendorId),
        usingModelService: effectiveVendorId === INTERNAL_ROUTER_VENDOR_ID,
        available: effectiveVendorId === INTERNAL_ROUTER_VENDOR_ID ? modelNames.has(row.model || parsed.model) : null,
      };
    });
}

function pickSelectedTextModel(agents: ReturnType<typeof summarizeAgents>) {
  const selected = agents.find((agent) => agent.key === "scriptAgent" && agent.usingModelService && agent.model);
  if (selected) return selected.model;
  return agents.find((agent) => agent.usingModelService && agent.model)?.model || "";
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
    !account ? "未绑定模型账号" : "",
    account && !account.apiKey ? "自动 API Key 未生成" : "",
    account && models.length === 0 ? "当前账号没有可用模型，请刷新或检查订阅/分站上架" : "",
    account && modelStats.text === 0 ? "未发现文本模型，Agent 暂不能使用模型服务" : "",
    account && modelStats.text > 0 && !selectedTextModel ? "尚未为当前用户选择 Agent 文本模型" : "",
  ].filter(Boolean);

  res.status(200).send(
    success({
      user,
      connected: Boolean(account),
      account: toPublicSubrouterAccount(account),
      models,
      modelStats,
      selectedTextModel,
      agentUseMode: await getUserSetting("agentUseMode", "0"),
      agents,
      diagnostics,
    }),
  );
});

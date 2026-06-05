import db from "@/utils/db";
import { getCurrentUserId } from "@/utils/requestContext";

export interface VendorConfigRow {
  id?: string;
  inputValues?: string | null;
  models?: string | null;
  enable?: number | null;
  userId?: number;
}

export interface AgentDeployRow {
  id?: number;
  key?: string | null;
  agentKey?: string | null;
  model?: string | null;
  modelName?: string | null;
  vendorId?: string | null;
  desc?: string | null;
  name?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  disabled?: boolean | null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {}
  return [];
}

export async function getUserSetting(key: string, fallback = ""): Promise<string> {
  const userId = getCurrentUserId();
  if (userId) {
    const row = await db("o_userSetting").where({ userId, key }).first();
    if (row?.value != null) return row.value;
  }
  const global = await db("o_setting").where("key", key).first();
  return global?.value ?? fallback;
}

export async function setUserSetting(key: string, value: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) {
    await db("o_setting").where("key", key).update({ value });
    return;
  }
  const exists = await db("o_userSetting").where({ userId, key }).first();
  if (exists) {
    await db("o_userSetting").where({ userId, key }).update({ value });
  } else {
    await db("o_userSetting").insert({ userId, key, value });
  }
}

export async function getEffectiveVendorConfig(vendorId: string, userId = getCurrentUserId()): Promise<VendorConfigRow | null> {
  const global = await db("o_vendorConfig").where("id", vendorId).first();
  if (!global) return null;
  if (!userId) return global;

  const userConfig = await db("o_userVendorConfig").where({ userId, vendorId }).first();
  if (!userConfig) return global;

  const inputValues = {
    ...parseJsonObject(global.inputValues),
    ...parseJsonObject(userConfig.inputValues),
  };
  const models = [...parseJsonArray(global.models), ...parseJsonArray(userConfig.models)];

  return {
    ...global,
    inputValues: JSON.stringify(inputValues),
    models: JSON.stringify(models),
    enable: userConfig.enable ?? global.enable,
    userId,
  };
}

export async function getEffectiveEnabledVendors(userId = getCurrentUserId()): Promise<VendorConfigRow[]> {
  const globalRows = (await db("o_vendorConfig").select("*")) as VendorConfigRow[];
  if (!userId) return globalRows.filter((row) => row.enable === 1);

  const userRows = (await db("o_userVendorConfig").where({ userId }).select("*")) as Array<{
    vendorId?: string | null;
    inputValues?: string | null;
    models?: string | null;
    enable?: number | null;
  }>;
  const userByVendor = new Map(userRows.map((row) => [row.vendorId, row]));

  return globalRows
    .map((global) => {
      const userConfig = userByVendor.get(global.id);
      if (!userConfig) return global;
      const inputValues = {
        ...parseJsonObject(global.inputValues),
        ...parseJsonObject(userConfig.inputValues),
      };
      const models = [...parseJsonArray(global.models), ...parseJsonArray(userConfig.models)];
      return {
        ...global,
        inputValues: JSON.stringify(inputValues),
        models: JSON.stringify(models),
        enable: userConfig.enable ?? global.enable,
        userId,
      };
    })
    .filter((row) => row.enable === 1);
}

export async function upsertUserVendorConfig(
  userId: number,
  vendorId: string,
  data: { inputValues?: Record<string, unknown>; models?: unknown[]; enable?: number },
): Promise<void> {
  const nowValues = data.inputValues ? JSON.stringify(data.inputValues) : undefined;
  const nowModels = data.models ? JSON.stringify(data.models) : undefined;
  const payload: Record<string, unknown> = {
    userId,
    vendorId,
    ...(nowValues !== undefined && { inputValues: nowValues }),
    ...(nowModels !== undefined && { models: nowModels }),
    ...(data.enable !== undefined && { enable: data.enable }),
  };
  const exists = await db("o_userVendorConfig").where({ userId, vendorId }).first();
  if (exists) {
    await db("o_userVendorConfig").where({ userId, vendorId }).update(payload);
  } else {
    await db("o_userVendorConfig").insert({
      userId,
      vendorId,
      inputValues: nowValues ?? "{}",
      models: nowModels ?? "[]",
      enable: data.enable ?? 0,
    });
  }
}

export async function getEffectiveAgentDeploy(agentKey: string, userId = getCurrentUserId()): Promise<AgentDeployRow | undefined> {
  if (userId) {
    const userRow = await db("o_userAgentDeploy").where({ userId, agentKey }).first();
    if (userRow) return { ...userRow, key: userRow.agentKey };
  }
  const global = await db("o_agentDeploy").where("key", agentKey).first();
  return global;
}

export async function getEffectiveAgentDeployList(userId = getCurrentUserId()): Promise<AgentDeployRow[]> {
  const globalRows = (await db("o_agentDeploy").select("*")) as AgentDeployRow[];
  if (!userId) return globalRows;

  const userRows = (await db("o_userAgentDeploy").where({ userId }).select("*")) as AgentDeployRow[];
  const userByKey = new Map(userRows.map((row) => [row.agentKey, row]));
  return globalRows.map((global) => {
    const userRow = userByKey.get(global.key ?? "");
    return userRow ? { ...global, ...userRow, id: global.id, key: global.key } : global;
  });
}

export async function upsertUserAgentDeploy(userId: number, agent: AgentDeployRow): Promise<void> {
  const agentKey = agent.agentKey ?? agent.key;
  if (!agentKey) throw new Error("缺少 agentKey");
  const payload = {
    userId,
    agentKey,
    model: agent.model ?? "",
    modelName: agent.modelName ?? "",
    vendorId: agent.vendorId ?? null,
    desc: agent.desc ?? "",
    name: agent.name ?? "",
    temperature: agent.temperature ?? null,
    maxOutputTokens: agent.maxOutputTokens ?? null,
    disabled: agent.disabled ?? false,
  };
  const exists = await db("o_userAgentDeploy").where({ userId, agentKey }).first();
  if (exists) {
    await db("o_userAgentDeploy").where({ userId, agentKey }).update(payload);
  } else {
    await db("o_userAgentDeploy").insert(payload);
  }
}

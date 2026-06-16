import db from "@/utils/db";
import { getCurrentUserId } from "@/utils/requestContext";
import getPath from "@/utils/getPath";
import path from "path";

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

export interface PromptRow {
  id?: number;
  name?: string | null;
  type?: string | null;
  data?: string | null;
  useData?: string | null;
  userId?: number;
  promptId?: number;
}

export interface ModelPromptRow {
  id?: number;
  userId?: number;
  vendorId?: string | null;
  model?: string | null;
  fileName?: string | null;
  path?: string | null;
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

export async function getUserSettings<T extends Record<string, string>>(defaults: T): Promise<T> {
  const keys = Object.keys(defaults);
  const result: Record<string, string> = { ...defaults };

  const globalRows = await db("o_setting").whereIn("key", keys);
  for (const row of globalRows) {
    if (row.key != null && row.value != null) result[row.key] = row.value;
  }

  const userId = getCurrentUserId();
  if (userId) {
    const userRows = await db("o_userSetting").where({ userId }).whereIn("key", keys);
    for (const row of userRows) {
      if (row.key != null && row.value != null) result[row.key] = row.value;
    }
  }

  return result as T;
}

export async function setUserSetting(key: string, value: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) {
    const exists = await db("o_setting").where({ key }).first();
    if (exists) {
      await db("o_setting").where({ key }).update({ value });
    } else {
      await db("o_setting").insert({ key, value });
    }
    return;
  }
  const exists = await db("o_userSetting").where({ userId, key }).first();
  if (exists) {
    await db("o_userSetting").where({ userId, key }).update({ value });
  } else {
    await db("o_userSetting").insert({ userId, key, value });
  }
}

export async function setUserSettings(values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await setUserSetting(key, value);
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
  const globalKeys = new Set(globalRows.map((row) => row.key).filter(Boolean));
  const effectiveRows = globalRows.map((global) => {
    const userRow = userByKey.get(global.key ?? "");
    return userRow ? { ...global, ...userRow, id: global.id, key: global.key } : global;
  });
  const userOnlyRows = userRows
    .filter((row) => row.agentKey && !globalKeys.has(row.agentKey))
    .map((row) => ({ ...row, key: row.agentKey }));
  const rows = [...effectiveRows, ...userOnlyRows];
  const rowsByKey = new Map(rows.map((row) => [row.key || row.agentKey, row]));

  return rows.map((row) => {
    const key = row.key || row.agentKey || "";
    if (!key.includes(":") || row.modelName) return row;

    const [mainKey] = key.split(/:(.+)/);
    const main = rowsByKey.get(mainKey);
    if (!main?.modelName) return row;

    return {
      ...row,
      model: main.model,
      modelName: main.modelName,
      vendorId: main.vendorId,
    };
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

function applyPromptOverride(global: PromptRow, override?: PromptRow | null, userId = getCurrentUserId()): PromptRow {
  if (!override) return global;
  return {
    ...global,
    data: override.data ?? global.data,
    useData: override.useData ?? global.useData,
    userId,
    promptId: global.id,
  };
}

export function resolvePromptContent(prompt?: PromptRow | null): string | undefined {
  if (!prompt) return undefined;
  return prompt.useData || prompt.data || undefined;
}

export async function getEffectivePromptList(userId = getCurrentUserId()): Promise<PromptRow[]> {
  const globalRows = (await db("o_prompt").select("*")) as PromptRow[];
  if (!userId) return globalRows;

  const userRows = (await db("o_userPrompt").where({ userId }).select("*")) as PromptRow[];
  const userByPromptId = new Map(userRows.map((row) => [row.promptId, row]));
  return globalRows.map((global) => applyPromptOverride(global, userByPromptId.get(global.id), userId));
}

export async function getEffectivePromptByType(type: string, userId = getCurrentUserId()): Promise<PromptRow | undefined> {
  const global = (await db("o_prompt").where({ type }).first()) as PromptRow | undefined;
  if (!global || !userId) return global;

  const override = (await db("o_userPrompt").where({ userId, promptId: global.id }).first()) as PromptRow | undefined;
  return applyPromptOverride(global, override, userId);
}

export async function upsertUserPrompt(userId: number, promptId: number, data: { data?: string | null; useData?: string | null }): Promise<void> {
  const global = (await db("o_prompt").where({ id: promptId }).first()) as PromptRow | undefined;
  if (!global) throw new Error("未找到提示词配置");

  const payload = {
    userId,
    promptId,
    data: data.data ?? global.data ?? "",
    useData: data.useData ?? data.data ?? "",
  };
  const exists = await db("o_userPrompt").where({ userId, promptId }).first();
  if (exists) {
    await db("o_userPrompt").where({ userId, promptId }).update(payload);
  } else {
    await db("o_userPrompt").insert(payload);
  }
}

export async function getEffectiveModelPrompt(vendorId: string, model: string, userId = getCurrentUserId()): Promise<ModelPromptRow | undefined> {
  if (userId) {
    const userRow = (await db("o_userModelPrompt").where({ userId, vendorId, model }).first()) as ModelPromptRow | undefined;
    if (userRow) return userRow;
  }
  return (await db("o_modelPrompt").where({ vendorId, model }).first()) as ModelPromptRow | undefined;
}

export async function getEffectiveModelPromptList(vendorId: string, userId = getCurrentUserId()): Promise<ModelPromptRow[]> {
  const globalRows = (await db("o_modelPrompt").where({ vendorId }).select("*")) as ModelPromptRow[];
  if (!userId) return globalRows;

  const userRows = (await db("o_userModelPrompt").where({ userId, vendorId }).select("*")) as ModelPromptRow[];
  const rowsByModel = new Map<string, ModelPromptRow>();
  for (const row of globalRows) {
    if (row.model) rowsByModel.set(row.model, row);
  }
  for (const row of userRows) {
    if (row.model) rowsByModel.set(row.model, row);
  }
  return [...rowsByModel.values()];
}

export async function upsertUserModelPrompt(
  userId: number,
  vendorId: string,
  model: string,
  data: { fileName?: string | null; path?: string | null },
): Promise<void> {
  const payload = {
    userId,
    vendorId,
    model,
    fileName: data.fileName ?? "",
    path: data.path ?? "",
  };
  const exists = await db("o_userModelPrompt").where({ userId, vendorId, model }).first();
  if (exists) {
    await db("o_userModelPrompt").where({ userId, vendorId, model }).update(payload);
  } else {
    await db("o_userModelPrompt").insert(payload);
  }
}

export function getModelPromptRootForUser(userId = getCurrentUserId()): string {
  return userId ? path.join(getPath(["modelPrompt"]), "users", String(userId)) : getPath(["modelPrompt"]);
}

export function getGlobalModelPromptRoot(): string {
  return getPath(["modelPrompt"]);
}

export function isUserModelPromptPath(filePath?: string | null): boolean {
  return typeof filePath === "string" && filePath.startsWith("users/");
}

export function getModelPromptFullPath(filePath: string): string {
  const root = path.resolve(getGlobalModelPromptRoot());
  const resolved = path.resolve(root, filePath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("非法模型提示词路径");
  }
  return resolved;
}

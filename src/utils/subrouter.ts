import axios, { AxiosError, AxiosInstance } from "axios";
import jwt from "jsonwebtoken";
import db from "@/utils/db";
import { getCode, writeCode } from "@/utils/vendor";
import { upsertUserAgentDeploy, upsertUserVendorConfig } from "@/utils/userConfig";

export type SubrouterProvider = "subrouterai" | "sub2api";

export interface SubrouterLoginOptions {
  provider: SubrouterProvider;
  baseUrl: string;
  username: string;
  password: string;
}

export interface NormalizedModel {
  name: string;
  modelName: string;
  type: "text" | "image" | "video";
  think?: boolean;
  mode?: Array<"text" | "singleImage" | "multiReference" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | string[]>;
  audio?: "optional" | boolean;
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
}

interface LoginResult {
  provider: SubrouterProvider;
  baseUrl: string;
  externalUserId?: string;
  username?: string;
  email?: string;
  displayName?: string;
  sessionCookie?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface StoredAccount extends LoginResult {
  userId: number;
  apiKey?: string;
  apiKeyId?: string;
  models?: string;
}

const SUBROUTER_VENDOR_ID = "subrouter";
const AUTO_KEY_PREFIX = "toonflow-auto";

function signToken(payload: string | object, expiresIn: string | number, secret: string): string {
  return (jwt.sign as any)(payload, secret, { expiresIn });
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function apiBase(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/, "");
}

function gatewayBase(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function buildCookie(headers: unknown): string {
  const cookies = Array.isArray(headers) ? headers : headers ? [String(headers)] : [];
  return cookies.map((cookie) => String(cookie).split(";")[0]).filter(Boolean).join("; ");
}

function bearer(apiKey: string): string {
  return `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`;
}

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as any;
    const msg = data?.message || data?.error?.message || data?.reason || err.message;
    return String(msg || "请求失败");
  }
  return err instanceof Error ? err.message : String(err);
}

function getAxios(baseUrl: string, headers: Record<string, string> = {}): AxiosInstance {
  return axios.create({
    baseURL: apiBase(baseUrl),
    timeout: 30000,
    headers,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

function extractItems(data: any): any[] {
  const candidates = [
    data?.data?.items,
    data?.data?.data,
    data?.data,
    data?.items,
    data,
  ];
  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }
  return [];
}

function extractUser(data: any): Record<string, any> {
  return data?.data?.user || data?.data || data?.user || {};
}

function extractKey(data: any): { key?: string; id?: string } {
  const body = data?.data || data;
  return {
    key: body?.key || body?.api_key || body?.token,
    id: body?.id != null ? String(body.id) : undefined,
  };
}

async function loginSubrouterAI(baseUrl: string, username: string, password: string): Promise<LoginResult> {
  const client = getAxios(baseUrl);
  const res = await client.post("/api/user/login", { username, password });
  if (res.data?.success === false) throw new Error(res.data?.message || "SubRouterAI 登录失败");
  const cookie = buildCookie(res.headers["set-cookie"]);
  if (!cookie) throw new Error("SubRouterAI 登录成功但未返回 session cookie");
  const user = extractUser(res.data);
  return {
    provider: "subrouterai",
    baseUrl: normalizeBaseUrl(baseUrl),
    externalUserId: user.id != null ? String(user.id) : undefined,
    username: user.username || username,
    email: user.email,
    displayName: user.display_name || user.displayName || user.username || username,
    sessionCookie: cookie,
  };
}

async function loginSub2API(baseUrl: string, email: string, password: string): Promise<LoginResult> {
  const client = getAxios(baseUrl);
  const res = await client.post("/api/v1/auth/login", { email, password });
  if (res.data?.code && res.data.code !== 0) throw new Error(res.data?.message || "Sub2API 登录失败");
  const data = res.data?.data || {};
  const user = data.user || {};
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) throw new Error("Sub2API 登录成功但未返回 access_token");
  return {
    provider: "sub2api",
    baseUrl: normalizeBaseUrl(baseUrl),
    externalUserId: user.id != null ? String(user.id) : undefined,
    username: user.username || user.name || email,
    email: user.email || email,
    displayName: user.display_name || user.displayName || user.name || email,
    accessToken,
    refreshToken: data.refresh_token || data.refreshToken,
  };
}

async function listSubrouterAIKeys(account: StoredAccount): Promise<any[]> {
  const client = getAxios(account.baseUrl, { Cookie: account.sessionCookie || "" });
  const res = await client.get("/api/token/");
  if (res.data?.success === false) throw new Error(res.data?.message || "获取 SubRouterAI Key 列表失败");
  return extractItems(res.data);
}

async function ensureSubrouterAIKey(account: StoredAccount): Promise<{ key: string; id?: string }> {
  const existing = (await listSubrouterAIKeys(account)).find((item) => String(item.name || "").startsWith(AUTO_KEY_PREFIX) && item.key);
  if (existing?.key) return { key: `sk-${String(existing.key).replace(/^sk-/, "")}`, id: existing.id != null ? String(existing.id) : undefined };

  const name = `${AUTO_KEY_PREFIX}-${Date.now()}`;
  const client = getAxios(account.baseUrl, { Cookie: account.sessionCookie || "" });
  const res = await client.post("/api/token/", {
    name,
    group: "subrouter",
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: false,
  });
  if (res.data?.success === false) throw new Error(res.data?.message || "创建 SubRouterAI Key 失败");

  const created = (await listSubrouterAIKeys(account)).find((item) => item.name === name && item.key);
  if (!created?.key) throw new Error("SubRouterAI Key 已创建但未能从列表中读取 key");
  return { key: `sk-${String(created.key).replace(/^sk-/, "")}`, id: created.id != null ? String(created.id) : undefined };
}

async function ensureSub2APIKey(account: StoredAccount): Promise<{ key: string; id?: string }> {
  const auth = { Authorization: bearer(account.accessToken || "") };
  const client = getAxios(account.baseUrl, auth);
  const listRes = await client.get("/api/v1/keys");
  const existing = extractItems(listRes.data).find((item) => String(item.name || "").startsWith(AUTO_KEY_PREFIX) && item.key);
  if (existing?.key) return { key: existing.key, id: existing.id != null ? String(existing.id) : undefined };

  const name = `${AUTO_KEY_PREFIX}-${Date.now()}`;
  const groupsRes = await client.get("/api/v1/groups/available").catch(() => ({ data: { data: [] } }));
  const groups = extractItems(groupsRes.data);
  const subrouterGroup = groups.find((group) => /subrouter|智能|订阅/i.test(`${group.name || ""} ${group.description || ""}`));
  const body: Record<string, unknown> = { name, quota: 0 };
  if (subrouterGroup?.id != null) body.group_id = Number(subrouterGroup.id);

  const createRes = await client.post("/api/v1/keys", body);
  const created = extractKey(createRes.data);
  if (!created.key) throw new Error("Sub2API Key 已创建但响应中没有 key");
  return { key: created.key, id: created.id };
}

async function fetchSubrouterAIModels(account: StoredAccount): Promise<NormalizedModel[]> {
  const client = getAxios(account.baseUrl, { Cookie: account.sessionCookie || "" });
  const subscribed = await client.get("/api/user/self/subrouter/models").catch((err: AxiosError) => {
    if (err.response?.status === 404) return { data: { data: [] } };
    throw err;
  });
  const rows = extractItems(subscribed.data);
  if (rows.length > 0) {
    return normalizeModels(
      rows.map((row) => ({
        id: row.model_name || row.modelName || row.id || row.name,
        category: row.category,
      })),
    );
  }
  return fetchGatewayModels(account.baseUrl, account.apiKey || "");
}

async function fetchGatewayModels(baseUrl: string, apiKey: string): Promise<NormalizedModel[]> {
  if (!apiKey) return [];
  const res = await axios.get(`${gatewayBase(baseUrl)}/models`, {
    timeout: 30000,
    headers: { Authorization: bearer(apiKey) },
  });
  return normalizeModels(extractItems(res.data).map((item) => ({ id: item.id || item.model || item.name, category: item.category || item.type })));
}

async function fetchSub2APIModels(account: StoredAccount): Promise<NormalizedModel[]> {
  return fetchGatewayModels(account.baseUrl, account.apiKey || "");
}

function inferType(modelName: string, category?: string): "text" | "image" | "video" {
  const haystack = `${modelName} ${category || ""}`.toLowerCase();
  if (/video|seedance|wan|kling|vidu|veo|sora|runway|hailuo|luma|pixverse/.test(haystack)) return "video";
  if (/image|img|seedream|nano|gpt-image|flux|dalle|dall-e|midjourney|mj|ideogram/.test(haystack)) return "image";
  return "text";
}

function normalizeModels(rows: Array<{ id?: string; category?: string }>): NormalizedModel[] {
  const map = new Map<string, NormalizedModel>();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    const type = inferType(id, row.category);
    const base = { name: id, modelName: id, type };
    if (type === "text") {
      map.set(id, { ...base, type: "text", think: /think|reason|r1|o[134]|deepseek-r|qwen3/i.test(id) });
    } else if (type === "image") {
      map.set(id, { ...base, type: "image", mode: ["text", "singleImage", "multiReference"] });
    } else {
      map.set(id, {
        ...base,
        type: "video",
        mode: ["text", "singleImage", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
        audio: "optional",
        durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p"] }],
      });
    }
  }
  return [...map.values()].sort((a, b) => a.modelName.localeCompare(b.modelName));
}

function subrouterVendorCode(): string {
  return `
type VideoMode = "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text" | string[];
interface TextModel { name: string; modelName: string; type: "text"; think: boolean; }
interface ImageModel { name: string; modelName: string; type: "image"; mode: ("text" | "singleImage" | "multiReference")[]; }
interface VideoModel { name: string; modelName: string; type: "video"; mode: VideoMode[]; audio: "optional" | false | true; durationResolutionMap: { duration: number[]; resolution: string[] }[]; }
interface TTSModel { name: string; modelName: string; type: "tts"; voices: { title: string; voice: string }[]; }
interface VendorConfig { id: string; version: string; name: string; author: string; description?: string; inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[]; inputValues: Record<string, string>; models: (TextModel | ImageModel | VideoModel | TTSModel)[]; }
type ReferenceList = { type: "image"; base64: string } | { type: "audio"; base64: string } | { type: "video"; base64: string };
interface ImageConfig { prompt: string; referenceList?: Extract<ReferenceList, { type: "image" }>[]; size: "1K" | "2K" | "4K"; aspectRatio: string; }
interface VideoConfig { duration: number; resolution: string; aspectRatio: "16:9" | "9:16"; prompt: string; referenceList?: ReferenceList[]; audio?: boolean; mode: VideoMode[]; }
interface TTSConfig { text: string; voice: string; speechRate: number; pitchRate: number; volume: number; referenceList?: Extract<ReferenceList, { type: "audio" }>[]; }
declare const createOpenAICompatible: any;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<{ completed: boolean; data?: string; error?: string }>, interval?: number, timeout?: number) => Promise<{ completed: boolean; data?: string; error?: string }>;
declare const exports: { vendor: VendorConfig; textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any; imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>; videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>; ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>; };

const vendor: VendorConfig = {
  id: "subrouter",
  version: "1.0",
  author: "ToonFlow",
  name: "SubRouter 智能路由",
  description: "使用 SubRouter 账户自动创建的用户级 Key，支持文本、图片、视频模型。",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "API基地址", type: "url", required: true },
  ],
  inputValues: { apiKey: "", baseUrl: "" },
  models: [],
};

const apiKey = () => vendor.inputValues.apiKey.replace(/^Bearer\\s+/i, "");
const baseUrl = () => vendor.inputValues.baseUrl.replace(/\\/+$/, "");
const headers = () => ({ Authorization: "Bearer " + apiKey(), "Content-Type": "application/json" });
const pickUrl = (data: any): string | undefined =>
  data?.data?.[0]?.url || data?.data?.[0]?.b64_json || data?.url || data?.video_url || data?.image_url || data?.data?.url || data?.data?.video_url || data?.data?.image_url || data?.data?.result_url || data?.content?.video_url;

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 SubRouter API Key");
  return createOpenAICompatible({ name: "subrouter", baseURL: baseUrl(), apiKey: apiKey() }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 SubRouter API Key");
  const body: any = {
    model: model.modelName,
    prompt: config.prompt,
    response_format: "url",
    size: config.size === "1K" ? "1024x1024" : config.size === "2K" ? "2048x2048" : "4096x4096",
  };
  const refs = (config.referenceList || []).map((r) => r.base64).filter(Boolean);
  if (refs.length > 0) body.image = refs.length === 1 ? refs[0] : refs;
  const response = await fetch(baseUrl() + "/images/generations", { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error("图片生成失败: " + response.status + " " + await response.text());
  const data = await response.json();
  const result = pickUrl(data);
  if (!result) throw new Error("图片生成失败：未返回图片");
  return result.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(result) ? result : await urlToBase64(result);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 SubRouter API Key");
  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image").map((r) => r.base64);
  const videoRefs = (config.referenceList || []).filter((r) => r.type === "video").map((r) => r.base64);
  const audioRefs = (config.referenceList || []).filter((r) => r.type === "audio").map((r) => r.base64);
  const body: any = {
    model: model.modelName,
    prompt: config.prompt,
    duration: config.duration,
    resolution: config.resolution || "720p",
    ratio: config.aspectRatio,
    metadata: {
      ratio: config.aspectRatio,
      generate_audio: model.audio === true || (model.audio === "optional" && config.audio !== false),
      references: [...imageRefs, ...videoRefs, ...audioRefs],
    },
  };
  if (imageRefs.length > 0) body.images = imageRefs;
  const response = await fetch(baseUrl() + "/video/generations", { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error("视频任务创建失败: " + response.status + " " + await response.text());
  const data = await response.json();
  const taskId = data?.id || data?.data?.id || data?.task_id || data?.data?.task_id;
  const direct = pickUrl(data);
  if (!taskId && direct) return direct.startsWith("data:") ? direct : await urlToBase64(direct);
  if (!taskId) throw new Error("视频任务创建失败：未返回任务 ID");
  const res = await pollTask(async () => {
    const query = await fetch(baseUrl() + "/video/generations/" + taskId, { method: "GET", headers: headers() });
    if (!query.ok) throw new Error("视频任务轮询失败: " + query.status + " " + await query.text());
    const queryData = await query.json();
    const status = String(queryData?.status || queryData?.data?.status || queryData?.state || "").toLowerCase();
    const url = pickUrl(queryData);
    if (url && /success|succeed|completed|finished|done/.test(status)) return { completed: true, data: url };
    if (/fail|error|cancel|expired/.test(status)) return { completed: true, error: queryData?.message || queryData?.data?.fail_reason || "视频生成失败" };
    return { completed: false };
  }, 10000, 1800000);
  if (res.error) throw new Error(res.error);
  if (!res.data) throw new Error("视频生成失败：未返回视频地址");
  return res.data.startsWith("data:") ? res.data : await urlToBase64(res.data);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => "";

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
export {};
`;
}

export async function ensureSubrouterVendor(): Promise<void> {
  const existing = await db("o_vendorConfig").where("id", SUBROUTER_VENDOR_ID).first();
  if (!existing) {
    await db("o_vendorConfig").insert({ id: SUBROUTER_VENDOR_ID, inputValues: "{}", models: "[]", enable: 0 });
  }
  const code = getCode(SUBROUTER_VENDOR_ID);
  if (!code || !code.includes("SubRouter 智能路由")) {
    writeCode(SUBROUTER_VENDOR_ID, subrouterVendorCode());
  }
}

async function saveAccount(account: StoredAccount): Promise<void> {
  const payload = {
    userId: account.userId,
    provider: account.provider,
    baseUrl: account.baseUrl,
    externalUserId: account.externalUserId ?? null,
    username: account.username ?? null,
    email: account.email ?? null,
    displayName: account.displayName ?? null,
    sessionCookie: account.sessionCookie ?? null,
    accessToken: account.accessToken ?? null,
    refreshToken: account.refreshToken ?? null,
    apiKey: account.apiKey ?? null,
    apiKeyId: account.apiKeyId ?? null,
    models: account.models ?? "[]",
    updatedTime: Date.now(),
  };
  const exists = await db("o_subrouterAccount").where({ userId: account.userId, provider: account.provider, baseUrl: account.baseUrl }).first();
  if (exists) {
    await db("o_subrouterAccount").where({ userId: account.userId, provider: account.provider, baseUrl: account.baseUrl }).update(payload);
  } else {
    await db("o_subrouterAccount").insert({ ...payload, createdTime: Date.now() });
  }
}

export async function getStoredSubrouterAccount(userId: number, provider?: SubrouterProvider, baseUrl?: string): Promise<StoredAccount | undefined> {
  let query = db("o_subrouterAccount").where({ userId }).orderBy("updatedTime", "desc");
  if (provider) query = query.andWhere("provider", provider);
  if (baseUrl) query = query.andWhere("baseUrl", normalizeBaseUrl(baseUrl));
  const row = await query.first();
  return row as StoredAccount | undefined;
}

export async function loginAndPrepareSubrouter(options: SubrouterLoginOptions): Promise<{
  token: string;
  toonflowUser: { id: number; name: string };
  account: StoredAccount;
  models: NormalizedModel[];
}> {
  await ensureSubrouterVendor();
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const login =
    options.provider === "subrouterai"
      ? await loginSubrouterAI(baseUrl, options.username, options.password)
      : await loginSub2API(baseUrl, options.username, options.password);

  const userName = `${login.provider}:${login.externalUserId || login.email || login.username || options.username}`;
  const localUser = await ensureLocalUser(userName, options.password);
  const account: StoredAccount = { ...login, userId: localUser.id };
  const key = login.provider === "subrouterai" ? await ensureSubrouterAIKey(account) : await ensureSub2APIKey(account);
  account.apiKey = key.key;
  account.apiKeyId = key.id;

  const models = login.provider === "subrouterai" ? await fetchSubrouterAIModels(account) : await fetchSub2APIModels(account);
  account.models = JSON.stringify(models);
  await saveAccount(account);
  await upsertUserVendorConfig(localUser.id, SUBROUTER_VENDOR_ID, {
    inputValues: { apiKey: account.apiKey, baseUrl: gatewayBase(account.baseUrl) },
    models,
    enable: 1,
  });

  const tokenData = await db("o_setting").where("key", "tokenKey").first();
  if (!tokenData?.value) throw new Error("未找到 ToonFlow tokenKey");
  const token = signToken({ id: localUser.id, name: localUser.name }, "180Days", tokenData.value);

  return {
    token: `Bearer ${token}`,
    toonflowUser: localUser,
    account,
    models,
  };
}

async function ensureLocalUser(name: string, fallbackPassword: string): Promise<{ id: number; name: string }> {
  const existing = await db("o_user").where("name", name).first();
  if (existing?.id) return { id: existing.id, name: existing.name || name };
  const max = await db("o_user").max<{ maxId?: number }>("id as maxId").first();
  const id = Math.max(Number(max?.maxId || 0) + 1, Date.now());
  await db("o_user").insert({ id, name, password: fallbackPassword });
  return { id, name };
}

export async function refreshStoredModels(userId: number, provider?: SubrouterProvider, baseUrl?: string): Promise<NormalizedModel[]> {
  const account = await getStoredSubrouterAccount(userId, provider, baseUrl);
  if (!account) throw new Error("未绑定 SubRouter 账户");
  const models = account.provider === "subrouterai" ? await fetchSubrouterAIModels(account) : await fetchSub2APIModels(account);
  await saveAccount({ ...account, models: JSON.stringify(models) });
  await upsertUserVendorConfig(userId, SUBROUTER_VENDOR_ID, {
    inputValues: { apiKey: account.apiKey, baseUrl: gatewayBase(account.baseUrl) },
    models,
    enable: 1,
  });
  return models;
}

export async function selectSubrouterModel(userId: number, modelName: string, targets: string[]): Promise<void> {
  const vendorId = SUBROUTER_VENDOR_ID;
  const model = modelName.includes(":") ? modelName.split(/:(.+)/)[1] : modelName;
  const modelId = `${vendorId}:${model}`;
  const deployRows = await db("o_agentDeploy").select("*");
  const targetSet = new Set(targets.length ? targets : ["scriptAgent", "productionAgent", "universalAi"]);
  for (const row of deployRows) {
    if (!row.key || !targetSet.has(row.key)) continue;
    await upsertUserAgentDeploy(userId, {
      ...row,
      key: row.key,
      agentKey: row.key,
      vendorId,
      model,
      modelName: modelId,
    });
  }
}

export function formatSubrouterError(err: unknown): string {
  return getErrorMessage(err);
}

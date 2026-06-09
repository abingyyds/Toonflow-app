import axios, { AxiosError, AxiosInstance } from "axios";
import jwt from "jsonwebtoken";
import db from "@/utils/db";
import { getCode, writeCode } from "@/utils/vendor";
import { upsertUserAgentDeploy, upsertUserVendorConfig } from "@/utils/userConfig";

export type SubrouterProvider = "subrouterai" | "sub2api";

export interface SubrouterLoginProvider {
  provider: SubrouterProvider;
  baseUrl: string;
}

export interface SubrouterLoginOptions {
  provider: SubrouterProvider;
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
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

type ModelSource = "subscription" | "gateway" | "dist-site";

interface ModelFetchResult {
  models: NormalizedModel[];
  source: ModelSource;
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
  distributorId?: number;
  distributorSlug?: string;
  distributorName?: string;
}

interface SubrouterAIDistributor {
  id: number;
  slug: string;
  name?: string;
  status?: number;
  parentId?: number;
  level?: number;
}

interface StoredAccount extends LoginResult {
  userId: number;
  apiKey?: string;
  apiKeyId?: string;
  models?: string;
}

interface PreparedSubrouterLogin {
  token: string;
  toonflowUser: { id: number; name: string };
  account: StoredAccount;
  models: NormalizedModel[];
  modelsSource: ModelSource;
  defaultTextModel?: NormalizedModel;
  notice?: string;
}

const SUBROUTER_VENDOR_ID = "subrouter";
const SUBROUTER_VENDOR_VERSION = "1.4";
const AUTO_KEY_PREFIX = "toonflow-auto";
const INTERNAL_SUBROUTER_BASE_URL = "http://subrouter.railway.internal:8080";
const SUBROUTER_LOGIN_PROVIDERS_SETTING_KEY = "subrouterLoginProviders";
const DEFAULT_TEXT_AGENT_TARGETS = ["scriptAgent", "productionAgent", "universalAi"];

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

function parseBaseUrlCandidates(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function getRuntimeSubrouterBaseUrlCandidates(accountBaseUrl?: string): string[] {
  return uniqueValues(
    [
      accountBaseUrl,
      process.env.TOONFLOW_SUBROUTER_PUBLIC_BASE_URL,
      process.env.SUBROUTER_PUBLIC_BASE_URL,
      process.env.TOONFLOW_SUBROUTER_FALLBACK_BASE_URL,
      process.env.SUBROUTER_FALLBACK_BASE_URL,
      ...parseBaseUrlCandidates(process.env.TOONFLOW_SUBROUTER_BASE_URL_CANDIDATES || process.env.SUBROUTER_BASE_URL_CANDIDATES),
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(gatewayBase),
  );
}

function buildSubrouterInputValues(account: Pick<StoredAccount, "apiKey" | "baseUrl">): Record<string, string> {
  const candidates = getRuntimeSubrouterBaseUrlCandidates(account.baseUrl);
  return {
    apiKey: account.apiKey || "",
    baseUrl: candidates[0] || gatewayBase(account.baseUrl),
    fallbackBaseUrl: candidates[1] || "",
    baseUrlCandidates: candidates.join("\n"),
  };
}

function buildCookie(headers: unknown): string {
  const cookies = Array.isArray(headers) ? headers : headers ? [String(headers)] : [];
  return cookies.map((cookie) => String(cookie).split(";")[0]).filter(Boolean).join("; ");
}

function bearer(apiKey: string): string {
  return `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`;
}

function subrouterAIAuthHeaders(account: StoredAccount): Record<string, string> {
  const headers: Record<string, string> = { Cookie: account.sessionCookie || "" };
  if (account.externalUserId) headers["New-Api-User"] = String(account.externalUserId);
  return headers;
}

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as any;
    const msg = data?.message || data?.error?.message || data?.reason || err.message;
    return String(msg || "请求失败");
  }
  return err instanceof Error ? err.message : String(err);
}

function getAxios(baseUrl: string, headers: Record<string, string> = {}, timeout = 30000): AxiosInstance {
  return axios.create({
    baseURL: apiBase(baseUrl),
    timeout,
    headers,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

function normalizeProviderName(value: unknown): SubrouterProvider | undefined {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "subrouterai" || provider === "sub2api") return provider;
  return undefined;
}

function normalizeLoginProviders(providers: Array<Partial<SubrouterLoginProvider> | undefined | null>): SubrouterLoginProvider[] {
  const seen = new Set<string>();
  const normalized: SubrouterLoginProvider[] = [];
  for (const item of providers) {
    const provider = normalizeProviderName(item?.provider);
    const baseUrl = typeof item?.baseUrl === "string" ? normalizeBaseUrl(item.baseUrl) : "";
    if (!provider || !baseUrl) continue;
    const key = `${provider}:${baseUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ provider, baseUrl });
  }
  return normalized;
}

function parseLoginProviders(value: unknown): SubrouterLoginProvider[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeLoginProviders(parsed);
    if (parsed && typeof parsed === "object") return normalizeLoginProviders([parsed as Partial<SubrouterLoginProvider>]);
  } catch {
    // Also accept compact env syntax: subrouterai=http://a;sub2api=http://b
  }

  return normalizeLoginProviders(
    raw.split(/[,\n;]/).flatMap((entry) => {
      const text = entry.trim();
      if (!text) return [];
      const matched = text.match(/^(subrouterai|sub2api)\s*=\s*(.+)$/i);
      if (matched) return [{ provider: matched[1].toLowerCase() as SubrouterProvider, baseUrl: matched[2].trim() }];
      if (/^https?:\/\//i.test(text)) {
        return [{ provider: "subrouterai" as const, baseUrl: text }];
      }
      return [];
    }),
  );
}

function subrouterAIOnly(providers: SubrouterLoginProvider[]): SubrouterLoginProvider[] {
  return providers.filter((provider) => provider.provider === "subrouterai");
}

function getEnvLoginProviders(): SubrouterLoginProvider[] {
  const providers: Array<Partial<SubrouterLoginProvider>> = [
    ...parseLoginProviders(process.env.TOONFLOW_SUBROUTER_LOGIN_PROVIDERS),
  ];
  const sharedBaseUrl = process.env.TOONFLOW_SUBROUTER_BASE_URL || process.env.SUBROUTER_BASE_URL;
  if (sharedBaseUrl) {
    providers.push({ provider: "subrouterai", baseUrl: sharedBaseUrl });
  }
  providers.push({ provider: "subrouterai", baseUrl: process.env.TOONFLOW_SUBROUTERAI_BASE_URL || process.env.SUBROUTERAI_BASE_URL });
  return normalizeLoginProviders(providers);
}

export async function getDefaultSubrouterLoginProviders(): Promise<SubrouterLoginProvider[]> {
  const providers: SubrouterLoginProvider[] = [...subrouterAIOnly(getEnvLoginProviders())];
  const setting = await db("o_setting").where("key", SUBROUTER_LOGIN_PROVIDERS_SETTING_KEY).first();
  providers.push(...subrouterAIOnly(parseLoginProviders(setting?.value)));
  providers.push({ provider: "subrouterai", baseUrl: INTERNAL_SUBROUTER_BASE_URL });
  return normalizeLoginProviders(providers);
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

function extractSubrouterAIDistributor(data: any): SubrouterAIDistributor | undefined {
  const body = data?.data || data || {};
  const rawDist = body.distributor || {};
  const id = Number(body.distributor_id || rawDist.id || 0);
  const rawBelongs = body.belongs_to_distributor ?? body.belongsToDistributor;
  const belongs = rawBelongs == null ? id > 0 : Boolean(rawBelongs);
  if (!belongs) return undefined;

  const slug = String(rawDist.slug || body.distributor_slug || body.distributorSlug || "").trim();
  if (!id || !slug) throw new Error("用户属于分站，但 SubRouterAI 未返回分站 slug");

  return {
    id,
    slug,
    name: rawDist.name || body.distributor_name || body.distributorName,
    status: rawDist.status != null ? Number(rawDist.status) : undefined,
    parentId: rawDist.parent_id != null ? Number(rawDist.parent_id) : undefined,
    level: rawDist.level != null ? Number(rawDist.level) : undefined,
  };
}

function extractKey(data: any): { key?: string; id?: string } {
  const body = data?.data || data;
  const nested = body?.token || body?.key_info || body?.keyInfo || body?.apiKey || body?.api_key;
  if (nested && typeof nested === "object") {
    return {
      key: nested.key || nested.api_key || nested.apiKey || nested.token,
      id: nested.id != null ? String(nested.id) : undefined,
    };
  }
  return {
    key: body?.key || body?.api_key || body?.token,
    id: body?.id != null ? String(body.id) : undefined,
  };
}

function normalizeSubrouterAIKey(key: string): string {
  return `sk-${String(key).replace(/^sk-/, "")}`;
}

function findReusableKey(items: any[]): { key: string; id?: string } | undefined {
  const existing = items.find((item) => String(item.name || "").startsWith(AUTO_KEY_PREFIX) && (item.key || item.api_key || item.token));
  if (!existing) return undefined;
  const key = existing.key || existing.api_key || existing.token;
  return { key: normalizeSubrouterAIKey(key), id: existing.id != null ? String(existing.id) : undefined };
}

async function loginSubrouterAI(baseUrl: string, username: string, password: string, timeoutMs?: number): Promise<LoginResult> {
  const client = getAxios(baseUrl, {}, timeoutMs);
  const res = await client.post("/api/user/login", { username, password });
  if (res.data?.success === false) throw new Error(res.data?.message || "内置智能路由登录失败");
  const cookie = buildCookie(res.headers["set-cookie"]);
  if (!cookie) throw new Error("内置智能路由登录成功但未返回会话信息");
  const user = extractUser(res.data);
  const externalUserId = user.id != null ? String(user.id) : undefined;
  const distributor = extractSubrouterAIDistributor(res.data);

  return {
    provider: "subrouterai",
    baseUrl: normalizeBaseUrl(baseUrl),
    externalUserId,
    username: user.username || username,
    email: user.email,
    displayName: user.display_name || user.displayName || user.username || username,
    sessionCookie: cookie,
    distributorId: distributor?.id,
    distributorSlug: distributor?.slug,
    distributorName: distributor?.name,
  };
}

async function loginSub2API(baseUrl: string, email: string, password: string, timeoutMs?: number): Promise<LoginResult> {
  const client = getAxios(baseUrl, {}, timeoutMs);
  const res = await client.post("/api/v1/auth/login", { email, password });
  if (res.data?.code && res.data.code !== 0) throw new Error(res.data?.message || "内置智能路由登录失败");
  const data = res.data?.data || {};
  const user = data.user || {};
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) throw new Error("内置智能路由登录成功但未返回访问令牌");
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
  const client = getAxios(account.baseUrl, subrouterAIAuthHeaders(account));
  if (account.distributorId) {
    const res = await client.get("/api/user/self/distributor/token/list", { params: { page: 1, page_size: 100 } });
    if (res.data?.success === false) throw new Error(res.data?.message || "获取分站访问密钥列表失败");
    return extractItems(res.data);
  }
  const res = await client.get("/api/token/");
  if (res.data?.success === false) throw new Error(res.data?.message || "获取内置智能路由访问密钥列表失败");
  return extractItems(res.data);
}

async function ensureSubrouterAIKey(account: StoredAccount): Promise<{ key: string; id?: string }> {
  if (account.distributorId) return ensureSubrouterAISelfDistributorKey(account);

  const existing = findReusableKey(await listSubrouterAIKeys(account));
  if (existing) return existing;

  const client = getAxios(account.baseUrl, subrouterAIAuthHeaders(account));
  const name = `${AUTO_KEY_PREFIX}-${Date.now()}`;
  const res = await client.post("/api/token/", {
    name,
    group: "subrouter",
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: false,
  });
  if (res.data?.success === false) throw new Error(res.data?.message || "创建内置智能路由访问密钥失败");

  const created = extractKey(res.data);
  if (created.key) return { key: normalizeSubrouterAIKey(created.key), id: created.id };

  const createdFromList = findReusableKey((await listSubrouterAIKeys(account)).filter((item) => item.name === name));
  if (!createdFromList) throw new Error("内置智能路由访问密钥已创建但未能从列表中读取");
  return createdFromList;
}

async function ensureSubrouterAISelfDistributorKey(account: StoredAccount): Promise<{ key: string; id?: string }> {
  const existing = findReusableKey(await listSubrouterAIKeys(account));
  if (existing) return existing;

  const client = getAxios(account.baseUrl, subrouterAIAuthHeaders(account));
  const name = `${AUTO_KEY_PREFIX}-${Date.now()}`;
  const res = await client.post("/api/user/self/distributor/token/create", {
    name,
    key_group_id: 0,
  });
  if (res.data?.success === false) throw new Error(res.data?.message || "创建分站访问密钥失败");

  const created = extractKey(res.data);
  if (created.key) return { key: normalizeSubrouterAIKey(created.key), id: created.id };

  const createdFromList = findReusableKey((await listSubrouterAIKeys(account)).filter((item) => item.name === name));
  if (!createdFromList) {
    throw new Error("分站访问密钥已创建但未能从列表中读取");
  }
  return createdFromList;
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
  if (!created.key) throw new Error("内置智能路由访问密钥已创建但响应中没有返回密钥");
  return { key: created.key, id: created.id };
}

async function fetchSubrouterAIModels(account: StoredAccount): Promise<ModelFetchResult> {
  const client = getAxios(account.baseUrl, subrouterAIAuthHeaders(account));
  if (account.distributorId) {
    return { models: await fetchGatewayModels(account.baseUrl, account.apiKey || ""), source: "dist-site" };
  }

  const subscribed = await client.get("/api/user/self/subrouter/models").catch((err: AxiosError) => {
    if (err.response?.status === 404) return { data: { data: [] } };
    throw err;
  });
  const rows = extractItems(subscribed.data);
  if (rows.length > 0) {
    return {
      models: normalizeModels(
        rows.map((row) => ({
          id: row.model_name || row.modelName || row.id || row.name,
          category: row.category,
        })),
      ),
      source: "subscription",
    };
  }
  return { models: await fetchGatewayModels(account.baseUrl, account.apiKey || ""), source: "gateway" };
}

async function fetchGatewayModels(baseUrl: string, apiKey: string): Promise<NormalizedModel[]> {
  if (!apiKey) return [];
  const res = await axios.get(`${gatewayBase(baseUrl)}/models`, {
    timeout: 30000,
    headers: { Authorization: bearer(apiKey) },
  });
  return normalizeModels(extractItems(res.data).map((item) => ({ id: item.id || item.model || item.name, category: item.category || item.type })));
}

async function fetchSub2APIModels(account: StoredAccount): Promise<ModelFetchResult> {
  return { models: await fetchGatewayModels(account.baseUrl, account.apiKey || ""), source: "gateway" };
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

function scoreTextModel(model: NormalizedModel): number {
  const text = `${model.name} ${model.modelName}`.toLowerCase();
  let score = 0;
  const preferences: Array<[RegExp, number]> = [
    [/claude.*sonnet|sonnet.*claude|sonnet/, 120],
    [/gpt-5|gpt-4\.?1|gpt-4o|gpt-4|o3|o4/, 110],
    [/deepseek.*(v3|chat|pro)|deepseek-ai\/deepseek/, 100],
    [/qwen.*(max|plus|72b|32b|coder)|qwen3/, 90],
    [/glm.*(5|4\.5|4-5)|kimi|moonshot/, 80],
    [/doubao.*(seed|pro|1-6|1\.6)/, 70],
    [/haiku|flash|lite|mini|small/, -10],
  ];
  for (const [pattern, weight] of preferences) {
    if (pattern.test(text)) score += weight;
  }
  if (/embedding|embed|rerank|moderation|whisper|speech|tts|audio/.test(text)) score -= 1000;
  if (model.think) score += 5;
  return score;
}

function pickDefaultTextModel(models: NormalizedModel[]): NormalizedModel | undefined {
  const textModels = models.filter((model) => model.type === "text");
  if (textModels.length === 0) return undefined;
  return [...textModels].sort((a, b) => {
    const scoreDiff = scoreTextModel(b) - scoreTextModel(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.modelName.localeCompare(b.modelName);
  })[0];
}

async function autoSelectDefaultTextAgentModels(userId: number, models: NormalizedModel[]): Promise<NormalizedModel | undefined> {
  const model = pickDefaultTextModel(models);
  if (!model) return undefined;
  await selectSubrouterModel(userId, model.modelName, DEFAULT_TEXT_AGENT_TARGETS);
  return model;
}

function buildModelNotice(result: ModelFetchResult, defaultTextModel?: NormalizedModel): string | undefined {
  if (result.models.length === 0) {
    return "未检测到可用模型，请在内置智能路由订阅商家，或确认分站已上架可用模型后刷新模型。";
  }
  if (!defaultTextModel) {
    return "已检测到内置智能路由可用模型，但没有可用于 ToonFlow Agent 的文本模型；图片/视频模型仍可在项目创建时选择。";
  }
  if (result.source === "dist-site") {
    return undefined;
  }
  if (result.source === "gateway") {
    return "未检测到当前用户自己的商家订阅，已自动使用分站可访问的模型，并设置默认文本模型。";
  }
  return undefined;
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
declare const axios: any;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<{ completed: boolean; data?: string; error?: string }>, interval?: number, timeout?: number) => Promise<{ completed: boolean; data?: string; error?: string }>;
declare const exports: { vendor: VendorConfig; textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any; imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>; videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>; ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>; };

const vendor: VendorConfig = {
  id: "subrouter",
  version: "${SUBROUTER_VENDOR_VERSION}",
  author: "ToonFlow",
  name: "内置智能路由",
  description: "使用内置智能路由自动创建的用户级访问密钥，支持文本、图片、视频模型。",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "API基地址", type: "url", required: true },
    { key: "fallbackBaseUrl", label: "备用API基地址", type: "url", required: false },
    { key: "baseUrlCandidates", label: "API候选地址", type: "text", required: false },
  ],
  inputValues: { apiKey: "", baseUrl: "", fallbackBaseUrl: "", baseUrlCandidates: "" },
  models: [],
};

const apiKey = () => vendor.inputValues.apiKey.replace(/^Bearer\\s+/i, "");
const normalizeUrl = (url: string): string => url.trim().replace(/\\/+$/, "");
const baseUrls = (): string[] => {
  const raw = [
    vendor.inputValues.baseUrl,
    vendor.inputValues.fallbackBaseUrl,
    ...(vendor.inputValues.baseUrlCandidates || "").split(/[,\\n;]/),
  ];
  const urls = raw.map((url) => normalizeUrl(String(url || ""))).filter(Boolean);
  return [...new Set(urls)];
};
let activeBaseUrl = "";
const baseUrl = () => activeBaseUrl || baseUrls()[0] || "";
const headers = () => ({ Authorization: "Bearer " + apiKey(), "Content-Type": "application/json" });
const URL_KEYS = new Set([
  "url",
  "uri",
  "download_url",
  "file_url",
  "video_url",
  "image_url",
  "audio_url",
  "result_url",
  "output_url",
  "signed_url",
  "b64_json",
]);
const isMediaPayload = (value: string): boolean => {
  const text = value.trim();
  return (
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("data:") ||
    (text.length > 80 && /^[A-Za-z0-9+/]+={0,2}$/.test(text))
  );
};
const mediaToBase64 = async (value: string): Promise<string> =>
  value.startsWith("http://") || value.startsWith("https://") ? await urlToBase64(value) : value;
const describeRequestError = (err: any): string => {
  const status = err?.response?.status;
  const code = err?.code || err?.cause?.code;
  const attemptedBaseUrl = err?.__baseUrl;
  const responseData = err?.response?.data;
  const responseText = responseData ? (typeof responseData === "string" ? responseData : JSON.stringify(responseData)) : "";
  return [
    attemptedBaseUrl ? "baseUrl=" + attemptedBaseUrl : "",
    status ? "status=" + status : "",
    code ? "code=" + code : "",
    err?.message || String(err),
    responseText ? "body=" + responseText.slice(0, 1000) : "",
  ].filter(Boolean).join(" ");
};
const shouldTryNextBaseUrl = (err: any): boolean => {
  const status = err?.response?.status;
  if (!status) return true;
  return [404, 405, 502, 503, 504].includes(Number(status));
};
const isEndpointFallbackError = (message: string): boolean => /(^|\\s)(status=)?(404|405)\\b/.test(message);
const requestJson = async (path: string, method: "GET" | "POST", body?: any): Promise<any> => {
  const candidates = baseUrls();
  if (candidates.length === 0) throw new Error(method + " " + path + " 未配置 API 基地址");
  const ordered = activeBaseUrl ? [activeBaseUrl, ...candidates.filter((url) => url !== activeBaseUrl)] : candidates;
  let lastErr: any;
  for (const candidate of ordered) {
    try {
      const response = await axios({
        url: candidate + path,
        method,
        headers: headers(),
        data: body,
        timeout: 120000,
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      activeBaseUrl = candidate;
      return response.data;
    } catch (err: any) {
      err.__baseUrl = candidate;
      lastErr = err;
      if (!shouldTryNextBaseUrl(err)) break;
    }
  }
  throw new Error(method + " " + path + " " + describeRequestError(lastErr));
};
const pickUrl = (data: any, seen = new Set<any>()): string | undefined => {
  if (data == null) return undefined;
  if (typeof data === "string") return isMediaPayload(data) ? data : undefined;
  if (typeof data !== "object") return undefined;
  if (seen.has(data)) return undefined;
  seen.add(data);
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = pickUrl(item, seen);
      if (value) return value;
    }
    return undefined;
  }
  for (const key of URL_KEYS) {
    const value = data[key];
    if (typeof value === "string" && isMediaPayload(value)) return value;
    const nested = pickUrl(value, seen);
    if (nested) return nested;
  }
  for (const key of ["data", "content", "output", "result", "results", "outputs", "file", "files", "asset", "assets", "video", "videos"]) {
    const value = pickUrl(data[key], seen);
    if (value) return value;
  }
  return undefined;
};
const pickTaskId = (data: any): string | undefined => {
  const direct =
    data?.request_id ||
    data?.requestId ||
    data?.id ||
    data?.task_id ||
    data?.taskId ||
    data?.data?.request_id ||
    data?.data?.requestId ||
    data?.data?.id ||
    data?.data?.task_id ||
    data?.data?.taskId;
  if (direct) return String(direct);
  const created = data?.data?.task || data?.task || data?.result?.task || data?.output?.task;
  const nested = created?.request_id || created?.requestId || created?.id || created?.task_id || created?.taskId;
  return nested ? String(nested) : undefined;
};
const pickStatus = (data: any): string =>
  String(data?.status || data?.state || data?.data?.status || data?.data?.state || data?.result?.status || data?.result?.state || data?.output?.status || data?.output?.state || "").toLowerCase();
const pickError = (data: any): string | undefined =>
  data?.error?.message ||
  data?.error ||
  data?.message ||
  data?.msg ||
  data?.data?.error?.message ||
  data?.data?.error ||
  data?.data?.message ||
  data?.data?.fail_reason ||
  data?.data?.failure_reason ||
  data?.result?.error?.message ||
  data?.result?.error ||
  data?.output?.error?.message ||
  data?.output?.error;

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少内置智能路由 API Key");
  return createOpenAICompatible({ name: "subrouter", baseURL: baseUrl(), apiKey: apiKey() }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少内置智能路由 API Key");
  const body: any = {
    model: model.modelName,
    prompt: config.prompt,
    response_format: "url",
    size: config.size === "1K" ? "1024x1024" : config.size === "2K" ? "2048x2048" : "4096x4096",
  };
  const refs = (config.referenceList || []).map((r) => r.base64).filter(Boolean);
  if (refs.length > 0) body.image = refs.length === 1 ? refs[0] : refs;
  const data = await requestJson("/images/generations", "POST", body).catch((err: any) => {
    throw new Error("图片生成失败: " + String(err?.message || err));
  });
  const result = pickUrl(data);
  if (!result) throw new Error("图片生成失败：未返回图片");
  return result.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(result) ? result : await urlToBase64(result);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少内置智能路由 API Key");
  const isGrokImagineVideo = /grok-imagine-video/i.test(model.modelName);
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
  if (isGrokImagineVideo) {
    delete body.ratio;
    delete body.metadata;
    delete body.images;
    body.aspect_ratio = config.aspectRatio;
    if (imageRefs.length === 1) body.image = { url: imageRefs[0] };
    if (imageRefs.length > 1) body.reference_images = imageRefs.map((url) => ({ url }));
  }
  let data: any;
  try {
    data = await requestJson(isGrokImagineVideo ? "/videos/generations" : "/video/generations", "POST", body);
  } catch (err: any) {
    const message = String(err?.message || err);
    if (!isEndpointFallbackError(message)) throw new Error("视频任务创建失败: " + message);
    data = await requestJson(isGrokImagineVideo ? "/video/generations" : "/videos/generations", "POST", body).catch((fallbackErr: any) => {
      throw new Error("视频任务创建失败: " + String(fallbackErr?.message || fallbackErr));
    });
  }
  const taskId = pickTaskId(data);
  const direct = pickUrl(data);
  console.info("[内置智能路由视频] 创建返回", {
    model: model.modelName,
    taskId,
    hasDirectUrl: Boolean(direct),
    keys: data && typeof data === "object" ? Object.keys(data).slice(0, 20) : typeof data,
  });
  if (!taskId && direct) return await mediaToBase64(direct);
  if (!taskId) throw new Error("视频任务创建失败：未返回任务 ID");
  const res = await pollTask(async () => {
    let queryData: any;
    try {
      queryData = await requestJson(isGrokImagineVideo ? "/videos/" + taskId : "/video/generations/" + taskId, "GET");
    } catch (err: any) {
      const message = String(err?.message || err);
      if (!isEndpointFallbackError(message)) throw new Error("视频任务轮询失败: " + message);
      queryData = await requestJson(isGrokImagineVideo ? "/video/generations/" + taskId : "/videos/" + taskId, "GET").catch((fallbackErr: any) => {
        throw new Error("视频任务轮询失败: " + String(fallbackErr?.message || fallbackErr));
      });
    }
    const status = pickStatus(queryData);
    const url = pickUrl(queryData);
    console.info("[内置智能路由视频] 轮询返回", {
      model: model.modelName,
      taskId,
      status,
      hasUrl: Boolean(url),
      keys: queryData && typeof queryData === "object" ? Object.keys(queryData).slice(0, 20) : typeof queryData,
    });
    if (url && (!status || /success|succeed|completed|finished|done/.test(status))) return { completed: true, data: url };
    if (/fail|error|cancel|expired/.test(status)) return { completed: true, error: pickError(queryData) || "视频生成失败" };
    return { completed: false };
  }, 10000, 1800000);
  if (res.error) throw new Error(res.error);
  if (!res.data) throw new Error("视频生成失败：未返回视频地址");
  return await mediaToBase64(res.data);
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
  const isAutoSubrouterVendor = !code || code.includes("SubRouter 智能路由") || code.includes("内置智能路由");
  const versionMatch = code.match(/version:\s*["']([^"']+)["']/);
  const currentVersion = versionMatch ? Number.parseFloat(versionMatch[1]) : 0;
  if (isAutoSubrouterVendor && (!code || !Number.isFinite(currentVersion) || currentVersion < Number.parseFloat(SUBROUTER_VENDOR_VERSION))) {
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
    distributorId: account.distributorId ?? null,
    distributorSlug: account.distributorSlug ?? null,
    distributorName: account.distributorName ?? null,
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

async function authenticateSubrouter(options: SubrouterLoginOptions): Promise<LoginResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  return options.provider === "subrouterai"
    ? await loginSubrouterAI(baseUrl, options.username, options.password, options.timeoutMs)
    : await loginSub2API(baseUrl, options.username, options.password, options.timeoutMs);
}

async function prepareSubrouterLogin(login: LoginResult, fallbackUsername: string, fallbackPassword: string): Promise<PreparedSubrouterLogin> {
  await ensureSubrouterVendor();
  const userName = `${login.provider}:${login.externalUserId || login.email || login.username || fallbackUsername}`;
  const localUser = await ensureLocalUser(userName, fallbackPassword);
  const account: StoredAccount = { ...login, userId: localUser.id };
  const key = login.provider === "subrouterai" ? await ensureSubrouterAIKey(account) : await ensureSub2APIKey(account);
  account.apiKey = key.key;
  account.apiKeyId = key.id;

  const modelResult = login.provider === "subrouterai" ? await fetchSubrouterAIModels(account) : await fetchSub2APIModels(account);
  const models = modelResult.models;
  account.models = JSON.stringify(models);
  await saveAccount(account);
  await upsertUserVendorConfig(localUser.id, SUBROUTER_VENDOR_ID, {
    inputValues: buildSubrouterInputValues(account),
    models,
    enable: 1,
  });
  const defaultTextModel = await autoSelectDefaultTextAgentModels(localUser.id, models);

  const tokenData = await db("o_setting").where("key", "tokenKey").first();
  if (!tokenData?.value) throw new Error("未找到 ToonFlow tokenKey");
  const token = signToken({ id: localUser.id, name: localUser.name }, "180Days", tokenData.value);

  return {
    token: `Bearer ${token}`,
    toonflowUser: localUser,
    account,
    models,
    modelsSource: modelResult.source,
    defaultTextModel,
    notice: buildModelNotice(modelResult, defaultTextModel),
  };
}

export async function loginAndPrepareSubrouter(options: SubrouterLoginOptions): Promise<PreparedSubrouterLogin> {
  const login = await authenticateSubrouter(options);
  return prepareSubrouterLogin(login, options.username, options.password);
}

export async function loginWithDefaultSubrouterProviders(username: string, password: string): Promise<PreparedSubrouterLogin | undefined> {
  const providers = await getDefaultSubrouterLoginProviders();
  let lastAuthError: unknown;
  for (const provider of providers) {
    let login: LoginResult;
    try {
      login = await authenticateSubrouter({ ...provider, username, password, timeoutMs: 10000 });
    } catch (err) {
      lastAuthError = err;
      continue;
    }
    return prepareSubrouterLogin(login, username, password);
  }
  if (lastAuthError) throw lastAuthError;
  return undefined;
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
  if (!account) throw new Error("未绑定内置智能路由账户");
  const modelResult = account.provider === "subrouterai" ? await fetchSubrouterAIModels(account) : await fetchSub2APIModels(account);
  const models = modelResult.models;
  await saveAccount({ ...account, models: JSON.stringify(models) });
  await upsertUserVendorConfig(userId, SUBROUTER_VENDOR_ID, {
    inputValues: buildSubrouterInputValues(account),
    models,
    enable: 1,
  });
  await autoSelectDefaultTextAgentModels(userId, models);
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

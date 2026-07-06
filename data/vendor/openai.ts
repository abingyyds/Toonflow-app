/**
 * Toonflow AI供应商模板
 * @version 2.0
 */
// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType?: "base64"; base64: string }
  | { type: "audio"; sourceType?: "base64"; base64: string }
  | { type: "video"; sourceType?: "base64"; base64: string };
interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  imageBase64?: string[];
  audio?: boolean;
  mode: VideoMode | VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}
interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const FormData: any;
declare const Buffer: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "openai",
  version: "2.0",
  author: "Toonflow",
  name: "OpenAI标准接口",
  description: "OpenAI标准格式接口，可修改请求地址并手动添加模型。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：http://subrouter.railway.internal:8080" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "http://subrouter.railway.internal:8080",
  },
  models: [
    { name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false },
    { name: "GPT-4.1", modelName: "gpt-4.1", type: "text", think: false },
    { name: "GPT-5.1", modelName: "gpt-5.1", type: "text", think: false },
    { name: "GPT-5.2", modelName: "gpt-5.2", type: "text", think: false },
    { name: "GPT-5.4", modelName: "gpt-5.4", type: "text", think: false },
    {
      name: "Sora 2",
      modelName: "sora-2",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional"],
      audio: true,
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p"] }],
    },
    {
      name: "Sora 2 Pro",
      modelName: "sora-2-pro",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional"],
      audio: true,
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p", "1080p"] }],
    },
  ],
};
// ============================================================
// 适配器函数
// ============================================================
const getBaseUrl = () => {
  const raw = vendor.inputValues.baseUrl.replace(/\/+$/, "");
  return /^https:\/\/api\.openai\.com$/i.test(raw) ? `${raw}/v1` : raw;
};

const getApiKey = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  return vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
};

const getAuthHeaders = () => ({ Authorization: `Bearer ${getApiKey()}` });

const getJsonHeaders = () => ({ ...getAuthHeaders(), "Content-Type": "application/json" });

const readByPath = (obj: any, path: string): any => {
  if (!obj || !path) return undefined;
  const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
  return normalizedPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const pickFirstPath = (obj: any, paths: string[]): any => {
  for (const path of paths) {
    const value = readByPath(obj, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const getModeEntries = (mode: VideoConfig["mode"]): any[] => (Array.isArray(mode) ? mode : [mode]);

const getReferenceLimit = (mode: VideoConfig["mode"], prefix: "imageReference" | "videoReference" | "audioReference"): number | undefined => {
  for (const entry of getModeEntries(mode)) {
    const values = Array.isArray(entry) ? entry : [entry];
    for (const value of values) {
      if (typeof value !== "string" || !value.startsWith(`${prefix}:`)) continue;
      const limit = Number(value.split(":")[1]);
      if (Number.isFinite(limit) && limit > 0) return limit;
    }
  }
  return undefined;
};

const getImageReferences = (config: VideoConfig): string[] => {
  const refs = (config.referenceList || [])
    .filter((item) => item.type === "image")
    .map((item) => item.base64)
    .filter(Boolean);
  const legacyRefs = (config.imageBase64 || []).filter(Boolean);
  const imageRefs = refs.length ? refs : legacyRefs;
  const limit = getReferenceLimit(config.mode, "imageReference");
  return limit ? imageRefs.slice(0, limit) : imageRefs;
};

const normalizeOpenAIVideoSeconds = (duration: number): string => {
  const value = Number(duration);
  const allowed = [4, 8, 12];
  if (allowed.includes(value)) return String(value);
  if (!Number.isFinite(value)) return "4";
  return String(allowed.reduce((best, current) => (Math.abs(current - value) < Math.abs(best - value) ? current : best), allowed[0]));
};

const normalizeOpenAIVideoSize = (resolution: string, aspectRatio: "16:9" | "9:16"): string => {
  const isPortrait = aspectRatio === "9:16";
  const normalized = String(resolution || "").toLowerCase();
  if (/1080|1024|1792|pro/.test(normalized)) return isPortrait ? "1024x1792" : "1792x1024";
  return isPortrait ? "720x1280" : "1280x720";
};

const ensureImageDataUrl = (value: string): string => {
  return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
};

const normalizeOpenAIReferenceImage = async (value: string, size: string): Promise<string> => {
  const [width, height] = size.split("x").map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return ensureImageDataUrl(value);
  return await zipImageResolution(ensureImageDataUrl(value), width, height);
};

const parseBase64File = (value: string) => {
  const match = value.match(/^data:([^;]+);base64,(.*)$/);
  const mime = match?.[1] || "image/png";
  const base64 = match?.[2] || value;
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return {
    buffer: Buffer.from(base64, "base64"),
    filename: `reference.${ext}`,
    contentType: mime,
  };
};

const extractOpenAIError = (value: any): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return (
    pickFirstPath(value, ["error.message", "error.code", "message", "last_error.message", "data.error.message", "data.message"]) ||
    undefined
  );
};

const extractOpenAIVideoUrl = (value: any): string | undefined => {
  return pickFirstPath(value, [
    "url",
    "video_url",
    "download_url",
    "content.video_url",
    "content.url",
    "output.video_url",
    "output.url",
    "data.url",
    "data.video_url",
    "data.content.video_url",
    "data.output.video_url",
  ]);
};

const axiosErrorMessage = (error: any, fallback: string): string => {
  return extractOpenAIError(error?.response?.data) || error?.message || fallback;
};

const downloadOpenAIVideoContent = async (videoId: string): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = { ...getAuthHeaders(), Accept: "video/mp4,application/octet-stream,*/*" };
  const paths = [`/videos/${videoId}/content?variant=video`, `/videos/${videoId}/content`];
  let lastError = "";

  for (const path of paths) {
    try {
      const response = await axios.get(`${baseUrl}${path}`, {
        headers,
        responseType: "arraybuffer",
        validateStatus: () => true,
      });
      if (response.status >= 200 && response.status < 300) {
        const contentType = String(response.headers?.["content-type"] || "video/mp4");
        if (contentType.includes("application/json")) {
          const text = Buffer.from(response.data).toString("utf-8");
          const parsed = JSON.parse(text);
          const directUrl = extractOpenAIVideoUrl(parsed);
          if (directUrl) return directUrl.startsWith("http") ? await urlToBase64(directUrl) : directUrl;
          throw new Error(extractOpenAIError(parsed) || "下载视频失败：返回 JSON 中未包含视频内容");
        }
        const mime = contentType.split(";")[0] || "video/mp4";
        return `data:${mime};base64,${Buffer.from(response.data).toString("base64")}`;
      }
      lastError = `状态码: ${response.status}, 错误信息: ${JSON.stringify(response.data)}`;
    } catch (error: any) {
      lastError = axiosErrorMessage(error, "下载视频失败");
    }
  }

  throw new Error(`下载视频失败：${lastError}`);
};

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  return createOpenAI({ baseURL: getBaseUrl(), apiKey: getApiKey() }).chat(model.modelName);
};
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const imageRefs = getImageReferences(config);
  const formData = new FormData();
  const size = normalizeOpenAIVideoSize(config.resolution, config.aspectRatio);

  formData.append("model", model.modelName);
  formData.append("prompt", config.prompt || "");
  formData.append("seconds", normalizeOpenAIVideoSeconds(config.duration));
  formData.append("size", size);

  if (imageRefs[0]) {
    const file = parseBase64File(await normalizeOpenAIReferenceImage(imageRefs[0], size));
    formData.append("input_reference", file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  logger(`[OpenAI视频生成] 提交任务，模型: ${model.modelName}`);

  let task: any;
  try {
    const createResponse = await axios.post(`${baseUrl}/videos`, formData, {
      headers: {
        ...getAuthHeaders(),
        ...formData.getHeaders(),
      },
    });
    task = createResponse.data;
  } catch (error: any) {
    throw new Error(`视频任务提交失败：${axiosErrorMessage(error, "OpenAI Videos API 请求失败")}`);
  }

  const taskId = task?.id || task?.data?.id;
  if (!taskId) throw new Error("视频任务提交失败：未返回任务ID");
  logger(`[OpenAI视频生成] 任务ID: ${taskId}`);

  const initialStatus = String(task?.status || task?.data?.status || "").toLowerCase();
  const initialUrl = extractOpenAIVideoUrl(task);
  if (["completed", "succeeded", "success"].includes(initialStatus) && initialUrl) {
    return initialUrl.startsWith("http") ? await urlToBase64(initialUrl) : initialUrl;
  }

  const result = await pollTask(
    async (): Promise<PollResult> => {
      let queryData: any;
      try {
        const queryResponse = await axios.get(`${baseUrl}/videos/${taskId}`, { headers: getJsonHeaders() });
        queryData = queryResponse.data;
      } catch (error: any) {
        return { completed: true, error: `视频任务查询失败：${axiosErrorMessage(error, "OpenAI Videos API 查询失败")}` };
      }

      const status = String(queryData?.status || queryData?.data?.status || "").toLowerCase();
      logger(`[OpenAI视频生成] 任务状态: ${status || "unknown"}`);

      switch (status) {
        case "completed":
        case "succeeded":
        case "success": {
          const directUrl = extractOpenAIVideoUrl(queryData);
          return { completed: true, data: directUrl || taskId };
        }
        case "failed":
        case "cancelled":
        case "canceled":
        case "expired":
          return { completed: true, error: extractOpenAIError(queryData) || "视频生成失败" };
        default:
          return { completed: false };
      }
    },
    10000,
    3000000,
  );

  if (result.error) throw new Error(result.error);
  const output = result.data || taskId;
  if (output.startsWith("http")) return await urlToBase64(output);
  if (output.startsWith("data:")) return output;
  return await downloadOpenAIVideoContent(output);
};
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
};
const updateVendor = async (): Promise<string> => {
  return "";
};
// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;
export {};

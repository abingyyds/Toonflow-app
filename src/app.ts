// import "./logger";
import "./err";
import "./env";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "socket.io";
import http from "node:http";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import crypto from "crypto";
import { ensureThumbnail, ThumbnailSize } from "@/utils/image";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { isEletron } from "@/utils/getPath";
import { normalizeAuthUser, runWithUser } from "@/utils/requestContext";

const app = express();
const server = http.createServer(app);
const WEB_CACHE_VERSION = "v8";
const WEB_MAIN_SCRIPT_PREFIX = "toonflow-inline-main";
const WEB_STYLESHEET_PREFIX = "toonflow-inline-style";
const LONG_CACHE_SECONDS = 60 * 60 * 24 * 365;

function getWebApiBaseUrlPatch() {
  return `<script>
(function () {
  try {
    if (location.protocol === "file:" || location.protocol === "toonflow:") return;
    var apiBaseUrl = location.origin + "/api";
    var apiFirstSegments = {
      agents: true,
      artStyle: true,
      assetsGenerate: true,
      common: true,
      cornerScape: true,
      flowProject: true,
      general: true,
      infiniteCanvas: true,
      login: true,
      modelSelect: true,
      novel: true,
      other: true,
      production: true,
      project: true,
      script: true,
      scriptAgent: true,
      setting: true,
      subrouter: true,
      task: true,
      test: true
    };
    var assetsApiSegments = {
      addAssets: true,
      addAudioAssets: true,
      batchDelete: true,
      batchGenerationData: true,
      delAssets: true,
      delImage: true,
      getAssetsApi: true,
      getImage: true,
      getMaterialData: true,
      pollingImageAssets: true,
      pollingPromptAssets: true,
      saveAssets: true,
      updateAssets: true,
      updateAudioAssets: true,
      uploadClip: true
    };
    var pluginApiSegments = {
      ai: true,
      file: true,
      tRPC: true
    };
    var legacyApiBasePattern = /http:\\/\\/(localhost|127\\.0\\.0\\.1):10588(\\/api)?/g;

    function installPublicWebStyle() {
      var style = document.createElement("style");
      style.textContent = [
        "body:not(.is-electron) .loginPage + .settingBtn > .t-button:last-child{display:none!important}",
        "body:not(.is-electron) .loginPage ~ .settingBtn > .t-button:last-child{display:none!important}",
        "body:not(.is-electron) .loginPage + .settingBtn > button:last-child{display:none!important}",
        "body:not(.is-electron) .loginPage ~ .settingBtn > button:last-child{display:none!important}",
        "body:not(.is-electron) .requestConfig input{pointer-events:none!important}",
        "body:not(.is-electron) .requestConfig .t-input{opacity:.72!important}"
      ].join("\\n");
      document.head.appendChild(style);
    }

    function normalizeSettingValue(key, raw) {
      if (typeof raw !== "string" || !raw) return raw;
      var replaced = raw.replace(legacyApiBasePattern, apiBaseUrl);
      legacyApiBasePattern.lastIndex = 0;
      try {
        var data = JSON.parse(replaced);
        if (!data || typeof data !== "object" || Array.isArray(data)) return replaced;
        if (key === "setting" || Object.prototype.hasOwnProperty.call(data, "baseUrl")) {
          data.baseUrl = apiBaseUrl;
          return JSON.stringify(data);
        }
      } catch (err) {
        return replaced;
      }
      return replaced;
    }

    var nativeSetItem = Storage.prototype.setItem;
    function lockStoredApiBaseUrl() {
      var foundSetting = false;
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (key === "setting") foundSetting = true;
        var raw = localStorage.getItem(key);
        var next = normalizeSettingValue(key, raw);
        if (next !== raw) nativeSetItem.call(localStorage, key, next);
      }
      if (!foundSetting) {
        nativeSetItem.call(localStorage, "setting", JSON.stringify({ baseUrl: apiBaseUrl }));
      }
    }

    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) value = normalizeSettingValue(String(key), String(value));
      return nativeSetItem.call(this, key, value);
    };

    function getApiPath(pathname, origin) {
      if (pathname === "/api") return "";
      if (pathname.indexOf("/api/") === 0) return pathname.slice(4);
      var parts = pathname.split("/");
      var first = parts[1] || "";
      var second = parts[2] || "";
      if (first === "assets") {
        return origin !== location.origin || assetsApiSegments[second] ? pathname : null;
      }
      if (first === "plugin") {
        return origin !== location.origin || pluginApiSegments[second] ? pathname : null;
      }
      return apiFirstSegments[first] ? pathname : null;
    }

    function rewriteHttpUrl(input) {
      if (typeof input !== "string" && !(input instanceof URL)) return input;
      var text = String(input);
      var parsed;
      try {
        parsed = new URL(text, location.href);
      } catch (err) {
        return input;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return input;
      if (parsed.pathname === "/socket.io/" || parsed.pathname.indexOf("/socket.io/") === 0) {
        if (parsed.origin === location.origin) return input;
        parsed.protocol = location.protocol;
        parsed.host = location.host;
        return parsed.toString();
      }
      var apiPath = getApiPath(parsed.pathname, parsed.origin);
      if (apiPath == null) return input;
      var locked = new URL(apiBaseUrl + apiPath);
      locked.search = parsed.search;
      locked.hash = parsed.hash;
      return locked.toString();
    }

    function rewriteSocketUrl(input) {
      if (typeof input !== "string" && !(input instanceof URL)) return input;
      var text = String(input);
      var parsed;
      try {
        parsed = new URL(text, location.href);
      } catch (err) {
        return input;
      }
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return input;
      if (parsed.pathname !== "/socket.io/" && parsed.pathname.indexOf("/socket.io/") !== 0) return input;
      if (parsed.host === location.host) return input;
      parsed.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      parsed.host = location.host;
      return parsed.toString();
    }

    var nativeFetch = window.fetch;
    if (typeof nativeFetch === "function") {
      window.fetch = function (input, init) {
        if (typeof Request !== "undefined" && input instanceof Request) {
          var rewrittenRequestUrl = rewriteHttpUrl(input.url);
          if (rewrittenRequestUrl !== input.url) input = new Request(rewrittenRequestUrl, input);
        } else {
          input = rewriteHttpUrl(input);
        }
        return nativeFetch.call(this, input, init);
      };
    }

    var nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      arguments[1] = rewriteHttpUrl(url);
      return nativeOpen.apply(this, arguments);
    };

    var NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === "function") {
      var LockedWebSocket = function (url, protocols) {
        return protocols === undefined ? new NativeWebSocket(rewriteSocketUrl(url)) : new NativeWebSocket(rewriteSocketUrl(url), protocols);
      };
      LockedWebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(LockedWebSocket, NativeWebSocket);
      window.WebSocket = LockedWebSocket;
    }

    installPublicWebStyle();
    lockStoredApiBaseUrl();
    window.__TOONFLOW_API_BASE_URL__ = apiBaseUrl;
    window.__TOONFLOW_BROWSER_API_BASE_URL__ = apiBaseUrl;
    window.__TOONFLOW_LOCKED_API_BASE_URL__ = apiBaseUrl;
  } catch (err) {}
})();
</script>`;
}

function patchLegacyApiBaseUrls(content: string): string {
  return content
    .replace(/(["'])http:\/\/(?:localhost|127\.0\.0\.1):10588\/api\1/g, '(location.origin + "/api")')
    .replace(/(["'])http:\/\/(?:localhost|127\.0\.0\.1):10588\1/g, '(location.origin + "/api")')
    .replace(
      /fetch\("toonflow:\/\/getAppUrl"\)/g,
      '((location.protocol === "file:" || location.protocol === "toonflow:") ? fetch("toonflow://getAppUrl") : Promise.resolve({ json: function () { return Promise.resolve({}); } }))',
    );
}

function prepareWebAssets(webDir: string) {
  const indexPath = path.join(webDir, "index.html");
  if (!fs.existsSync(indexPath)) return webDir;

  const indexStat = fs.statSync(indexPath);
  const cacheKey = crypto
    .createHash("sha256")
    .update(`${WEB_CACHE_VERSION}:${webDir}:${indexStat.size}:${indexStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  const cacheDir = u.getPath(["web-cache", cacheKey]);
  const cachedIndexPath = path.join(cacheDir, "index.html");
  if (fs.existsSync(cachedIndexPath)) return cacheDir;

  fs.mkdirSync(cacheDir, { recursive: true });

  let html = fs.readFileSync(indexPath, "utf8");
  const hasPatchedApiBaseUrl = html.includes("window.__TOONFLOW_API_BASE_URL__");
  html = patchLegacyApiBaseUrls(html);

  if (!hasPatchedApiBaseUrl && !html.includes("(location.origin + \"/api\")")) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  } else if (!hasPatchedApiBaseUrl) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  }

  const inlineModuleScript = /<script type="module" crossorigin>([\s\S]*?)<\/script>/;
  const match = html.match(inlineModuleScript);
  if (match && match[1].length > 1024 * 1024) {
    const scriptBuffer = Buffer.from(match[1], "utf8");
    const scriptHash = crypto.createHash("sha256").update(scriptBuffer).digest("hex").slice(0, 12);
    const scriptFile = `${WEB_MAIN_SCRIPT_PREFIX}-${scriptHash}.js`;
    const scriptPath = path.join(cacheDir, scriptFile);
    fs.writeFileSync(scriptPath, match[1], "utf8");
    writeCompressedVariants(scriptPath, scriptBuffer);
    html = html.replace(match[0], `<script type="module" crossorigin src="./${scriptFile}"></script>`);
  }

  const inlineStyle = /<style[^>]*>([\s\S]*?)<\/style>/;
  const styleMatch = html.match(inlineStyle);
  if (styleMatch && styleMatch[1].length > 256 * 1024) {
    const styleBuffer = Buffer.from(styleMatch[1], "utf8");
    const styleHash = crypto.createHash("sha256").update(styleBuffer).digest("hex").slice(0, 12);
    const styleFile = `${WEB_STYLESHEET_PREFIX}-${styleHash}.css`;
    const stylePath = path.join(cacheDir, styleFile);
    fs.writeFileSync(stylePath, styleMatch[1], "utf8");
    writeCompressedVariants(stylePath, styleBuffer);
    html = html.replace(styleMatch[0], `<link rel="stylesheet" crossorigin href="./${styleFile}" />`);
  }

  for (const file of fs.readdirSync(webDir)) {
    if (!file.endsWith(".js")) continue;
    const filePath = path.join(webDir, file);
    if (!fs.statSync(filePath).isFile()) continue;
    writeCompressedVariants(path.join(cacheDir, file), fs.readFileSync(filePath));
  }

  fs.writeFileSync(path.join(cacheDir, "index.html"), html, "utf8");
  return cacheDir;
}

function writeCompressedVariants(targetPath: string, content: Buffer) {
  fs.writeFileSync(`${targetPath}.gz`, zlib.gzipSync(content, { level: 9 }));
  fs.writeFileSync(`${targetPath}.br`, zlib.brotliCompressSync(content, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
}

function setWebStaticHeaders(res: Response, filePath: string) {
  if (path.basename(filePath) === "index.html") {
    res.setHeader("Cache-Control", "no-cache");
    return;
  }

  if (/\.(?:js|css|ico|png|jpg|jpeg|webp|gif|svg|woff2?)$/i.test(filePath)) {
    res.setHeader("Cache-Control", `public, max-age=${LONG_CACHE_SECONDS}, immutable`);
  }
}

function getStaticContentType(fileName: string) {
  return fileName.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
}

function getProjectIdForAuth(req: Request): number | null {
  const body = (req.body || {}) as Record<string, unknown>;
  const projectId = Number(body.projectId);
  if (Number.isFinite(projectId) && projectId > 0) return projectId;

  const apiPath = req.path.startsWith("/api/") ? req.path : `/api${req.path}`;
  const idIsProjectRoutes = new Set([
    "/api/project/delProject",
    "/api/project/editProject",
    "/api/general/getSingleProject",
    "/api/general/updateProject",
    "/api/general/generalStatistics",
  ]);
  const id = Number(body.id);
  if (idIsProjectRoutes.has(apiPath) && Number.isFinite(id) && id > 0) return id;
  return null;
}

async function assertProjectAccess(req: Request, res: Response, userId: number): Promise<boolean> {
  const projectId = getProjectIdForAuth(req);
  if (!projectId) return true;
  const project = await u.db("o_project").where("id", projectId).select("userId").first();
  if (!project) {
    res.status(404).send({ message: "项目不存在" });
    return false;
  }
  if (project.userId != null && Number(project.userId) !== userId) {
    res.status(403).send({ message: "无权访问该项目" });
    return false;
  }
  return true;
}

function sendPrecompressedStatic(cacheDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const requestedFile = path.basename(req.path);
    if (req.path !== `/${requestedFile}` || !/\.(?:js|css)$/i.test(requestedFile)) return next();

    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    const brotliPath = path.join(cacheDir, `${requestedFile}.br`);
    const gzipPath = path.join(cacheDir, `${requestedFile}.gz`);

    if (/\bbr\b/.test(acceptEncoding) && fs.existsSync(brotliPath)) {
      res.setHeader("Content-Encoding", "br");
      res.setHeader("Content-Type", getStaticContentType(requestedFile));
      res.setHeader("Vary", "Accept-Encoding");
      setWebStaticHeaders(res, requestedFile);
      res.sendFile(brotliPath);
      return;
    }

    if (!/\bgzip\b/.test(acceptEncoding) || !fs.existsSync(gzipPath)) return next();
    res.setHeader("Content-Type", getStaticContentType(requestedFile));
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    setWebStaticHeaders(res, requestedFile);
    res.sendFile(gzipPath);
  };
}

async function checkPermissions() {
  if (!isEletron()) return true;
  const userDataPath = u.getPath();
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const testFile = path.join(userDataPath, ".access_test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (e) {
    const { dialog, app } = require("electron");
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "权限不足",
      message: "应用无法访问数据目录",
      detail: `无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,
      buttons: ["确认退出"],
      defaultId: 0,
    });
    if (response === 0) {
      app.quit();
    }
  }
}

export default async function startServe(randomPort: Boolean = false) {
  await checkPermissions();

  await u.writeVersion();
  const io = new Server(server, { cors: { origin: "*" } });
  socketInit(io);

  if (process.env.NODE_ENV == "dev") await buildRoute();

  expressWs(app);

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  app.get("/healthz", (_, res) => res.status(200).send("ok"));

  // oss 静态资源
  const ossDir = u.getPath("oss");
  if (!fs.existsSync(ossDir)) {
    fs.mkdirSync(ossDir, { recursive: true });
  }
  console.log("文件目录:", ossDir);
  app.use(
    "/oss",
    (req, res, next) => {
      if (req.url === "/oss" || req.url.startsWith("/oss/")) {
        req.url = req.url.slice(4) || "/";
      }

      // 如果传参 size=20 或 size=200x300，则返回小图
      if (req.query.size) {
        const size = req.query.size as string;
        const smallImageBaseDir = path.join(ossDir, "smallImage");
        const originalPath = path.join(ossDir, req.path);

        // 解析 size 参数
        let sizeSubDir: string;
        let sizeOpts: ThumbnailSize | undefined;

        // 判断是否为 WIDTHxHEIGHT 格式，如 "200x300"：等比压缩到指定宽高边界
        const dimensMatch = size.match(/^(\d+)x(\d+)$/i);
        // 判断是否为百分比格式，如 "30"、"30%"：等比压缩到原图的指定百分比
        const percentMatch = size.match(/^(\d+(?:\.\d+)?)\s*%?$/);

        if (dimensMatch) {
          const w = parseInt(dimensMatch[1], 10);
          const h = parseInt(dimensMatch[2], 10);
          sizeSubDir = `${w}x${h}`;
          sizeOpts = { type: "dimensions", width: w, height: h };
        } else if (percentMatch) {
          const pct = parseFloat(percentMatch[1]);
          sizeSubDir = `${percentMatch[1]}p`;
          sizeOpts = { type: "percentage", value: pct };
        } else {
          // 无效的 size 参数，降级返回原图
          express.static(ossDir, { acceptRanges: false })(req, res, next);
          return;
        }

        const ext = path.extname(req.path);
        const base = path.basename(req.path, ext);
        const dir = path.dirname(req.path);
        const smallImagePath = path.join(smallImageBaseDir, dir, `${base}_${sizeSubDir}${ext}`);

        ensureThumbnail(originalPath, smallImagePath, sizeOpts).then((thumbnailPath) => {
          if (thumbnailPath) {
            res.sendFile(thumbnailPath);
          } else {
            // 缩略图生成失败，降级返回原图
            express.static(ossDir, { acceptRanges: false })(req, res, next);
          }
        });
        return;
      }
      next();
    },
    express.static(ossDir, { acceptRanges: false }),
    (_, res) => res.status(404).end(),
  );

  const pluginDir = u.getPath("plugin");

  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
  }
  console.log("文件目录:", pluginDir);
  app.use("/plugin", express.static(pluginDir, { acceptRanges: false }));

  // skills 静态资源
  const skillsDir = u.getPath("skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  console.log("文件目录:", skillsDir);
  // 只允许图片文件访问
  app.use(
    "/skills",
    (req, res, next) => {
      /\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path) ? next() : res.status(403).end();
    },
    express.static(skillsDir, { acceptRanges: false }),
  );

  // assets 静态资源
  const assetsDir = u.getPath("assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  console.log("文件目录:", assetsDir);
  app.use("/assets", express.static(assetsDir, { acceptRanges: false }));

  // data/web 静态网站
  const webDir = u.getPath("web");
  if (fs.existsSync(webDir)) {
    console.log("静态网站目录:", webDir);
    const preparedWebDir = prepareWebAssets(webDir);
    app.use(sendPrecompressedStatic(preparedWebDir));
    app.use(express.static(preparedWebDir, { acceptRanges: false, setHeaders: setWebStaticHeaders }));
    app.use(express.static(webDir, { acceptRanges: false, setHeaders: setWebStaticHeaders }));
  } else {
    console.warn("静态网站目录不存在:", webDir);
  }
  console.log("静态网站目录:", webDir);
  app.use(async (req, res, next) => {
    const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
    if (!setting) return res.status(444).send({ message: "服务器秘钥未配置，请联系管理员" });
    const { value: tokenKey } = setting;
    // 从 header 或 query 参数获取 token
    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");
    // 白名单路径
    const apiPath = req.path.startsWith("/api/") ? req.path : `/api${req.path}`;
    if (apiPath === "/api/login/login" || apiPath === "/api/subrouter/login") return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      const authUser = normalizeAuthUser(decoded);
      if (!authUser) return res.status(401).send({ message: "无效的token" });
      (req as any).user = decoded;
      if (authUser && !(await assertProjectAccess(req, res, authUser.id))) return;
      runWithUser(authUser, () => next());
    } catch (err) {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  const router = await import("@/router");
  await router.default(app);

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "API 404 Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });

  const configuredPort = Number.parseInt(process.env.PORT ?? "10588", 10);
  const port = randomPort ? 0 : Number.isFinite(configuredPort) ? configuredPort : 10588;
  return await new Promise((resolve) => {
    const onListening = async () => {
      const address = server.address();
      const realPort = typeof address === "string" ? address : address?.port;
      console.log(`[服务启动成功]: http://localhost:${realPort}`);
      resolve(realPort);
    };

    if (randomPort) {
      server.listen(port, onListening);
    } else {
      server.listen(port, "0.0.0.0", onListening);
    }
  });
}

// 支持await关闭
export function closeServe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => {
        if (err) return reject(err);
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) startServe();

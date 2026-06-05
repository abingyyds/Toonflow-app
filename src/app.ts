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
import os from "os";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { isEletron } from "@/utils/getPath";

const app = express();
const server = http.createServer(app);
const WEB_MAIN_SCRIPT = "toonflow-inline-main.js";
const WEB_MAIN_SCRIPT_GZIP = `${WEB_MAIN_SCRIPT}.gz`;
const WEB_MAIN_SCRIPT_BROTLI = `${WEB_MAIN_SCRIPT}.br`;

function getWebApiBaseUrlPatch() {
  return `<script>
(function () {
  try {
    if (location.protocol === "file:" || location.protocol === "toonflow:") return;
    var apiBaseUrl = location.origin + "/api";
    for (var i = 0; i < localStorage.length; i += 1) {
      var key = localStorage.key(i);
      if (!key || key.indexOf("setting") === -1) continue;
      var raw = localStorage.getItem(key);
      if (!raw || raw.indexOf("localhost:10588") === -1) continue;
      localStorage.setItem(key, raw.replace(/http:\\/\\/localhost:10588\\/api/g, apiBaseUrl));
    }
    window.__TOONFLOW_API_BASE_URL__ = apiBaseUrl;
  } catch (err) {}
})();
</script>`;
}

function prepareWebAssets(webDir: string) {
  const indexPath = path.join(webDir, "index.html");
  if (!fs.existsSync(indexPath)) return webDir;

  const cacheDir = path.join(os.tmpdir(), "toonflow-web-cache", Buffer.from(webDir).toString("hex").slice(0, 32));
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  let html = fs.readFileSync(indexPath, "utf8");
  const hasPatchedApiBaseUrl = html.includes("window.__TOONFLOW_API_BASE_URL__");
  html = html.replace(/"http:\/\/localhost:10588\/api"/g, '(location.origin + "/api")');

  if (!hasPatchedApiBaseUrl && !html.includes("(location.origin + \"/api\")")) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  } else if (!hasPatchedApiBaseUrl) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  }

  const inlineModuleScript = /<script type="module" crossorigin>([\s\S]*?)<\/script>/;
  const match = html.match(inlineModuleScript);
  if (match && match[1].length > 1024 * 1024) {
    const scriptPath = path.join(cacheDir, WEB_MAIN_SCRIPT);
    const gzipPath = path.join(cacheDir, WEB_MAIN_SCRIPT_GZIP);
    const brotliPath = path.join(cacheDir, WEB_MAIN_SCRIPT_BROTLI);
    const scriptBuffer = Buffer.from(match[1], "utf8");
    fs.writeFileSync(scriptPath, match[1], "utf8");
    fs.writeFileSync(gzipPath, zlib.gzipSync(scriptBuffer, { level: 9 }));
    fs.writeFileSync(brotliPath, zlib.brotliCompressSync(scriptBuffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
    html = html.replace(match[0], `<script type="module" crossorigin src="./${WEB_MAIN_SCRIPT}"></script>`);
  }

  fs.writeFileSync(path.join(cacheDir, "index.html"), html, "utf8");
  return cacheDir;
}

function sendPrecompressedStatic(webDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path !== `/${WEB_MAIN_SCRIPT}`) return next();
    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    const brotliPath = path.join(webDir, WEB_MAIN_SCRIPT_BROTLI);
    const gzipPath = path.join(webDir, WEB_MAIN_SCRIPT_GZIP);

    if (/\bbr\b/.test(acceptEncoding) && fs.existsSync(brotliPath)) {
      res.setHeader("Content-Encoding", "br");
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Vary", "Accept-Encoding");
      res.sendFile(brotliPath);
      return;
    }

    if (!/\bgzip\b/.test(acceptEncoding) || !fs.existsSync(gzipPath)) return next();
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
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
  app.use("/oss", express.static(ossDir, { acceptRanges: false }));
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
    app.use(express.static(preparedWebDir, { acceptRanges: false }));
    app.use(express.static(webDir, { acceptRanges: false }));
  } else {
    console.warn("静态网站目录不存在:", webDir);
  }

  app.use(async (req, res, next) => {
    const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
    if (!setting) return res.status(444).send({ message: "服务器秘钥未配置，请联系管理员" });
    const { value: tokenKey } = setting;
    // 从 header 或 query 参数获取 token
    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");
    // 白名单路径
    if (req.path === "/api/login/login") return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      (req as any).user = decoded;
      next();
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

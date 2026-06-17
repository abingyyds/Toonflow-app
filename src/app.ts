import "./logger";
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
const WEB_CACHE_VERSION = "v11";
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
      "model-service": true,
      novel: true,
      other: true,
      production: true,
      project: true,
      script: true,
      scriptAgent: true,
      setting: true,
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

function getModelServiceSettingsPatch() {
  return `<script>
(function () {
  if (window.__TOONFLOW_MODEL_SERVICE_SETTINGS__) return;
  window.__TOONFLOW_MODEL_SERVICE_SETTINGS__ = true;

  var TARGET_LABELS = {
    scriptAgent: "剧本 Agent",
    productionAgent: "生产 Agent",
    universalAi: "通用 AI"
  };
  var TYPE_LABELS = {
    text: "文本",
    image: "图片",
    video: "视频",
    other: "其他"
  };
  var state = {
    open: false,
    loading: false,
    refreshing: false,
    saving: false,
    testing: false,
    error: "",
    toast: "",
    filter: "text",
    search: "",
    selectedModel: "",
    targets: { scriptAgent: true, productionAgent: true, universalAi: true },
    summary: null,
    testResult: null
  };

  function apiBase() {
    return window.__TOONFLOW_API_BASE_URL__ || (location.origin + "/api");
  }

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (err) { return null; }
  }

  function extractToken(value, depth) {
    if (depth > 4 || value == null) return "";
    if (typeof value === "string") {
      var text = value.trim();
      if (/^Bearer\\s+/i.test(text)) return text;
      if (/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(text)) return "Bearer " + text;
      var matched = text.match(/Bearer\\s+[A-Za-z0-9._~+\\/-]+=*/i);
      if (matched) return matched[0];
      var parsed = safeJsonParse(text);
      return parsed ? extractToken(parsed, depth + 1) : "";
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        var arrToken = extractToken(value[i], depth + 1);
        if (arrToken) return arrToken;
      }
      return "";
    }
    if (typeof value === "object") {
      var preferred = ["token", "accessToken", "access_token", "authorization", "Authorization", "auth", "user", "userInfo", "login"];
      for (var p = 0; p < preferred.length; p += 1) {
        if (Object.prototype.hasOwnProperty.call(value, preferred[p])) {
          var directToken = extractToken(value[preferred[p]], depth + 1);
          if (directToken) return directToken;
        }
      }
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k += 1) {
        var token = extractToken(value[keys[k]], depth + 1);
        if (token) return token;
      }
    }
    return "";
  }

  function findToken() {
    var storages = [];
    try { storages.push(localStorage); } catch (err) {}
    try { storages.push(sessionStorage); } catch (err) {}
    var preferredKeys = ["token", "user", "userInfo", "login", "auth", "pinia-user", "toonflow-user"];
    for (var s = 0; s < storages.length; s += 1) {
      var storage = storages[s];
      for (var p = 0; p < preferredKeys.length; p += 1) {
        var rawPreferred = storage.getItem(preferredKeys[p]);
        var preferredToken = extractToken(rawPreferred, 0);
        if (preferredToken) return preferredToken;
      }
      for (var i = 0; i < storage.length; i += 1) {
        var key = storage.key(i);
        if (!key) continue;
        var token = extractToken(storage.getItem(key), 0);
        if (token) return token;
      }
    }
    return "";
  }

  function post(path, body) {
    var token = findToken();
    if (!token) return Promise.reject(new Error("未找到登录令牌，请重新登录"));
    return fetch(apiBase() + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = safeJsonParse(text) || {};
        if (!res.ok) throw new Error(json.message || json.error || text || "请求失败");
        if (json.code && json.code !== 200) throw new Error(json.message || "请求失败");
        return json.data;
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    try { return new Date(n).toLocaleString(); } catch (err) { return "-"; }
  }

  function setToast(message) {
    state.toast = message || "";
    render();
    if (message) {
      window.clearTimeout(setToast.timer);
      setToast.timer = window.setTimeout(function () {
        state.toast = "";
        render();
      }, 2600);
    }
  }

  function setLoading(key, value) {
    state[key] = value;
    render();
  }

  function loadSummary() {
    state.loading = true;
    state.error = "";
    render();
    return post("/model-service/summary", {})
      .then(function (data) {
        state.summary = data;
        if (!state.selectedModel && data && data.selectedTextModel) state.selectedModel = data.selectedTextModel;
        state.error = "";
      })
      .catch(function (err) {
        state.error = err && err.message ? err.message : String(err);
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function refreshModels() {
    state.refreshing = true;
    state.error = "";
    render();
    return post("/model-service/models", { refresh: true })
      .then(function () {
        setToast("模型列表已刷新");
        return loadSummary();
      })
      .catch(function (err) {
        state.error = err && err.message ? err.message : String(err);
      })
      .finally(function () {
        state.refreshing = false;
        render();
      });
  }

  function saveModel() {
    if (!state.selectedModel) {
      setToast("请选择文本模型");
      return;
    }
    var targets = Object.keys(state.targets).filter(function (key) { return state.targets[key]; });
    if (targets.length === 0) {
      setToast("请选择作用目标");
      return;
    }
    state.saving = true;
    state.error = "";
    render();
    return post("/model-service/selectModel", { modelName: state.selectedModel, targets: targets })
      .then(function () {
        setToast("模型已保存到当前用户");
        return loadSummary();
      })
      .catch(function (err) {
        state.error = err && err.message ? err.message : String(err);
      })
      .finally(function () {
        state.saving = false;
        render();
      });
  }

  function testModel() {
    if (!state.selectedModel) {
      setToast("请选择文本模型");
      return;
    }
    state.testing = true;
    state.testResult = null;
    state.error = "";
    render();
    return post("/model-service/testModel", { modelName: state.selectedModel })
      .then(function (data) {
        state.testResult = data || {};
        setToast("模型测试通过");
      })
      .catch(function (err) {
        state.testResult = { available: false, message: err && err.message ? err.message : String(err) };
      })
      .finally(function () {
        state.testing = false;
        render();
      });
  }

  function installStyle() {
    if (document.getElementById("toonflow-model-service-style")) return;
    var style = document.createElement("style");
    style.id = "toonflow-model-service-style";
    style.textContent = [
      ".tf-model-service-entry{position:fixed;right:18px;top:76px;z-index:9998;height:40px;padding:0 14px;border:1px solid rgba(17,24,39,.16);border-radius:8px;background:#111827;color:#fff;box-shadow:0 10px 28px rgba(15,23,42,.18);display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:0}",
      ".tf-model-service-entry:hover{background:#0f172a}",
      ".tf-model-service-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af;box-shadow:0 0 0 3px rgba(156,163,175,.18);flex:0 0 auto}",
      ".tf-model-service-dot.is-on{background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.18)}",
      ".tf-model-service-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.32);display:flex;justify-content:flex-end}",
      ".tf-model-service-backdrop[hidden]{display:none}",
      ".tf-model-service-panel{width:min(760px,100vw);height:100vh;background:#f8fafc;color:#111827;box-shadow:-18px 0 36px rgba(15,23,42,.22);display:flex;flex-direction:column;border-left:1px solid rgba(15,23,42,.08)}",
      ".tf-model-service-head{height:64px;padding:0 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;background:#fff;flex:0 0 auto}",
      ".tf-model-service-title{font-size:18px;font-weight:700;letter-spacing:0}",
      ".tf-model-service-close{width:34px;height:34px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-size:22px;line-height:28px}",
      ".tf-model-service-body{padding:18px 20px 28px;overflow:auto;display:flex;flex-direction:column;gap:14px}",
      ".tf-model-service-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".tf-model-service-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;min-width:0}",
      ".tf-model-service-card h3{margin:0 0 12px;font-size:15px;font-weight:700;color:#111827;letter-spacing:0}",
      ".tf-model-service-kv{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px 10px;font-size:13px;line-height:1.55}",
      ".tf-model-service-kv span:nth-child(odd){color:#6b7280}",
      ".tf-model-service-kv span:nth-child(even){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".tf-model-service-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}",
      ".tf-model-service-stat{border:1px solid #e5e7eb;border-radius:8px;padding:10px;background:#f9fafb}",
      ".tf-model-service-stat b{display:block;font-size:20px;line-height:1.1}",
      ".tf-model-service-stat span{font-size:12px;color:#6b7280}",
      ".tf-model-service-alert{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5}",
      ".tf-model-service-error{border-color:#fecaca;background:#fef2f2;color:#991b1b}",
      ".tf-model-service-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".tf-model-service-btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#111827;cursor:pointer;font-size:13px;font-weight:600}",
      ".tf-model-service-btn.primary{border-color:#0f766e;background:#0f766e;color:#fff}",
      ".tf-model-service-btn:disabled{opacity:.55;cursor:not-allowed}",
      ".tf-model-service-control{display:flex;flex-direction:column;gap:6px;min-width:0}",
      ".tf-model-service-control label{font-size:12px;color:#6b7280}",
      ".tf-model-service-select,.tf-model-service-input{height:36px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827;padding:0 10px;font-size:13px;min-width:0}",
      ".tf-model-service-targets{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}",
      ".tf-model-service-check{display:flex;align-items:center;gap:6px;font-size:13px;color:#374151}",
      ".tf-model-service-tabs{display:flex;gap:6px;flex-wrap:wrap}",
      ".tf-model-service-tab{height:30px;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;cursor:pointer}",
      ".tf-model-service-tab.is-active{background:#ecfdf5;border-color:#10b981;color:#065f46}",
      ".tf-model-service-model-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:310px;overflow:auto;padding-right:2px}",
      ".tf-model-service-model{border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:10px;display:flex;flex-direction:column;gap:6px;min-width:0}",
      ".tf-model-service-model strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".tf-model-service-model small{font-size:12px;color:#6b7280}",
      ".tf-model-service-pill{display:inline-flex;align-items:center;width:max-content;height:22px;padding:0 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px}",
      ".tf-model-service-agent{width:100%;border-collapse:collapse;font-size:13px}",
      ".tf-model-service-agent th,.tf-model-service-agent td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}",
      ".tf-model-service-agent th{color:#6b7280;font-weight:600;background:#f9fafb}",
      ".tf-model-service-muted{color:#6b7280;font-size:13px;line-height:1.5}",
      ".tf-model-service-toast{position:fixed;right:24px;top:130px;z-index:10002;background:#111827;color:#fff;border-radius:8px;padding:10px 12px;font-size:13px;box-shadow:0 10px 28px rgba(15,23,42,.2)}",
      "@media (max-width:720px){.tf-model-service-entry{right:12px;top:auto;bottom:18px}.tf-model-service-panel{width:100vw}.tf-model-service-body{padding:14px}.tf-model-service-row{grid-template-columns:1fr}.tf-model-service-model-list{grid-template-columns:1fr}.tf-model-service-stats{grid-template-columns:repeat(2,1fr)}}"
    ].join("\\n");
    document.head.appendChild(style);
  }

  function accountHtml(summary) {
    var account = summary && summary.account;
    if (!account) {
      return '<div class="tf-model-service-muted">当前用户未绑定模型账号。</div>';
    }
    return [
      '<div class="tf-model-service-kv">',
      '<span>账号</span><span>' + escapeHtml(account.displayName || account.username || account.email || "-") + '</span>',
      '<span>分站</span><span>' + escapeHtml(account.distributorName || "-") + '</span>',
      '<span>Key</span><span>' + (account.apiKeyReady ? "已生成" : "未生成") + '</span>',
      '<span>更新时间</span><span>' + escapeHtml(formatTime(account.updatedTime)) + '</span>',
      '</div>'
    ].join("");
  }

  function statsHtml(summary) {
    var stats = summary && summary.modelStats || {};
    return ["text", "image", "video", "other"].map(function (type) {
      return '<div class="tf-model-service-stat"><b>' + Number(stats[type] || 0) + '</b><span>' + TYPE_LABELS[type] + '</span></div>';
    }).join("");
  }

  function modelSelectHtml(models, selected) {
    var textModels = models.filter(function (model) { return model.type === "text"; });
    if (!selected && textModels.length > 0) selected = textModels[0].modelName || "";
    if (!state.selectedModel && selected) state.selectedModel = selected;
    var options = ['<option value="">请选择文本模型</option>'].concat(textModels.map(function (model) {
      var name = model.modelName || model.name || "";
      return '<option value="' + escapeHtml(name) + '"' + (name === state.selectedModel ? " selected" : "") + '>' + escapeHtml(name) + '</option>';
    }));
    return '<select class="tf-model-service-select" data-action="select-model">' + options.join("") + '</select>';
  }

  function targetsHtml() {
    return '<div class="tf-model-service-targets">' + Object.keys(TARGET_LABELS).map(function (key) {
      return '<label class="tf-model-service-check"><input type="checkbox" data-target="' + key + '"' + (state.targets[key] ? " checked" : "") + '> ' + TARGET_LABELS[key] + '</label>';
    }).join("") + '</div>';
  }

  function modelsHtml(summary) {
    var models = summary && Array.isArray(summary.models) ? summary.models : [];
    var filter = state.filter || "text";
    var search = String(state.search || "").trim().toLowerCase();
    var filtered = models.filter(function (model) {
      var type = model.type || "other";
      var name = String(model.modelName || model.name || "");
      return (filter === "all" || type === filter) && (!search || name.toLowerCase().indexOf(search) >= 0);
    }).slice(0, 180);
    return [
      '<div class="tf-model-service-card">',
      '<h3>模型列表</h3>',
      '<div class="tf-model-service-actions" style="justify-content:space-between;margin-bottom:10px">',
      '<div class="tf-model-service-tabs">',
      ["text", "image", "video", "all"].map(function (type) {
        var label = type === "all" ? "全部" : TYPE_LABELS[type];
        return '<button class="tf-model-service-tab ' + (filter === type ? "is-active" : "") + '" data-filter="' + type + '">' + label + '</button>';
      }).join(""),
      '</div>',
      '<input class="tf-model-service-input" data-action="search" placeholder="搜索模型" value="' + escapeHtml(state.search) + '" style="width:210px">',
      '</div>',
      filtered.length
        ? '<div class="tf-model-service-model-list">' + filtered.map(function (model) {
            var type = model.type || "other";
            var name = model.modelName || model.name || "";
            return '<div class="tf-model-service-model"><strong title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</strong><div><span class="tf-model-service-pill">' + escapeHtml(TYPE_LABELS[type] || type) + '</span></div><small>' + (model.think ? "支持思考" : "可用") + '</small></div>';
          }).join("") + '</div>'
        : '<div class="tf-model-service-muted">没有匹配的模型。</div>',
      '</div>'
    ].join("");
  }

  function agentsHtml(summary) {
    var agents = summary && Array.isArray(summary.agents) ? summary.agents : [];
    if (!agents.length) return '<div class="tf-model-service-muted">暂无 Agent 配置。</div>';
    return '<table class="tf-model-service-agent"><thead><tr><th>目标</th><th>当前模型</th><th>状态</th></tr></thead><tbody>' + agents.map(function (agent) {
      var status = agent.usingModelService ? (agent.available === false ? "模型不存在" : "模型服务") : (agent.modelName ? "其他供应商" : "未配置");
      return '<tr><td>' + escapeHtml(agent.name || TARGET_LABELS[agent.key] || agent.key) + '</td><td>' + escapeHtml(agent.model || "-") + '</td><td>' + escapeHtml(status) + '</td></tr>';
    }).join("") + '</tbody></table>';
  }

  function bodyHtml() {
    var token = findToken();
    var summary = state.summary;
    var models = summary && Array.isArray(summary.models) ? summary.models : [];
    if (!token) {
      return '<div class="tf-model-service-card"><h3>账号与模型</h3><div class="tf-model-service-alert tf-model-service-error">未找到登录令牌，请重新登录后再打开设置。</div></div>';
    }
    var diagnostics = summary && Array.isArray(summary.diagnostics) ? summary.diagnostics : [];
    return [
      state.error ? '<div class="tf-model-service-alert tf-model-service-error">' + escapeHtml(state.error) + '</div>' : '',
      diagnostics.length ? '<div class="tf-model-service-alert">' + diagnostics.map(escapeHtml).join('<br>') + '</div>' : '',
      '<div class="tf-model-service-row">',
      '<div class="tf-model-service-card"><h3>当前账号</h3>' + accountHtml(summary) + '</div>',
      '<div class="tf-model-service-card"><h3>可用模型</h3><div class="tf-model-service-stats">' + statsHtml(summary) + '</div></div>',
      '</div>',
      '<div class="tf-model-service-card">',
      '<h3>Agent 文本模型</h3>',
      '<div class="tf-model-service-row">',
      '<div class="tf-model-service-control"><label>文本模型</label>' + modelSelectHtml(models, summary && summary.selectedTextModel) + '</div>',
      '<div class="tf-model-service-control"><label>操作</label><div class="tf-model-service-actions">',
      '<button class="tf-model-service-btn primary" data-action="save" ' + (state.saving ? "disabled" : "") + '>' + (state.saving ? "保存中" : "保存选择") + '</button>',
      '<button class="tf-model-service-btn" data-action="test" ' + (state.testing ? "disabled" : "") + '>' + (state.testing ? "测试中" : "测试模型") + '</button>',
      '<button class="tf-model-service-btn" data-action="refresh" ' + (state.refreshing ? "disabled" : "") + '>' + (state.refreshing ? "刷新中" : "刷新模型") + '</button>',
      '</div></div>',
      '</div>',
      targetsHtml(),
      state.testResult ? '<div class="tf-model-service-alert ' + (state.testResult.available === false ? "tf-model-service-error" : "") + '" style="margin-top:10px">' + escapeHtml(state.testResult.available === false ? (state.testResult.message || "模型测试失败") : ("模型可用，耗时 " + (state.testResult.latencyMs || 0) + "ms")) + '</div>' : '',
      '</div>',
      '<div class="tf-model-service-card"><h3>当前 Agent 配置</h3>' + agentsHtml(summary) + '</div>',
      modelsHtml(summary),
      state.loading && !summary ? '<div class="tf-model-service-card"><div class="tf-model-service-muted">加载中...</div></div>' : ''
    ].join("");
  }

  function render() {
    var root = document.getElementById("toonflow-model-service-root");
    if (!root) return;
    var connected = state.summary && state.summary.connected;
    root.innerHTML = [
      '<button class="tf-model-service-entry" data-action="open" type="button"><span class="tf-model-service-dot ' + (connected ? "is-on" : "") + '"></span><span>模型设置</span></button>',
      '<div class="tf-model-service-backdrop" ' + (state.open ? "" : "hidden") + ' data-action="backdrop">',
      '<section class="tf-model-service-panel" role="dialog" aria-modal="true" aria-label="账号与模型设置">',
      '<header class="tf-model-service-head"><div class="tf-model-service-title">账号与模型设置</div><button class="tf-model-service-close" data-action="close" type="button">×</button></header>',
      '<main class="tf-model-service-body">' + bodyHtml() + '</main>',
      '</section></div>',
      state.toast ? '<div class="tf-model-service-toast">' + escapeHtml(state.toast) + '</div>' : ''
    ].join("");
    refreshEntryVisibility();
  }

  function refreshEntryVisibility() {
    var button = document.querySelector(".tf-model-service-entry");
    if (!button) return;
    var onLoginPage = !!document.querySelector(".loginPage");
    button.style.display = !findToken() && onLoginPage ? "none" : "flex";
  }

  function installEvents(root) {
    root.addEventListener("click", function (event) {
      var target = event.target;
      var actionEl = target && target.closest ? target.closest("[data-action]") : null;
      if (!actionEl) return;
      var action = actionEl.getAttribute("data-action");
      if (action === "open") {
        state.open = true;
        render();
        loadSummary();
      } else if (action === "close") {
        state.open = false;
        render();
      } else if (action === "backdrop" && actionEl === event.target) {
        state.open = false;
        render();
      } else if (action === "refresh") {
        refreshModels();
      } else if (action === "save") {
        saveModel();
      } else if (action === "test") {
        testModel();
      }
    });
    root.addEventListener("change", function (event) {
      var target = event.target;
      if (!target) return;
      if (target.getAttribute("data-action") === "select-model") {
        state.selectedModel = target.value;
        state.testResult = null;
        render();
      }
      var targetKey = target.getAttribute("data-target");
      if (targetKey) {
        state.targets[targetKey] = !!target.checked;
        render();
      }
    });
    root.addEventListener("input", function (event) {
      var target = event.target;
      if (target && target.getAttribute("data-action") === "search") {
        state.search = target.value || "";
        render();
      }
    });
    root.addEventListener("click", function (event) {
      var target = event.target;
      var filterEl = target && target.closest ? target.closest("[data-filter]") : null;
      if (!filterEl) return;
      state.filter = filterEl.getAttribute("data-filter") || "text";
      render();
    });
  }

  function install() {
    installStyle();
    if (document.getElementById("toonflow-model-service-root")) return;
    var root = document.createElement("div");
    root.id = "toonflow-model-service-root";
    document.body.appendChild(root);
    installEvents(root);
    render();
    window.setInterval(refreshEntryVisibility, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
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
  const hasModelServiceSettingsPatch = html.includes("window.__TOONFLOW_MODEL_SERVICE_SETTINGS__");
  html = patchLegacyApiBaseUrls(html);

  if (!hasPatchedApiBaseUrl && !html.includes("(location.origin + \"/api\")")) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  } else if (!hasPatchedApiBaseUrl) {
    html = html.replace("<script type=\"module\"", `${getWebApiBaseUrlPatch()}\n    <script type="module"`);
  }
  if (!hasModelServiceSettingsPatch) {
    html = html.replace("<script type=\"module\"", `${getModelServiceSettingsPatch()}\n    <script type="module"`);
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

const projectIdFromIdRoutes = new Set([
  "/api/project/delProject",
  "/api/project/editProject",
  "/api/general/getSingleProject",
  "/api/general/updateProject",
  "/api/general/generalStatistics",
]);

const assetIdFromIdRoutes = new Set([
  "/api/assets/batchDelete",
  "/api/assets/delAssets",
  "/api/assets/saveAssets",
  "/api/assets/updateAssets",
  "/api/assets/updateAudioAssets",
  "/api/assetsGenerate/generateAssets",
  "/api/cornerScape/pollingAudio",
  "/api/production/assets/deleteAssetsDireve",
  "/api/production/assets/pollingImage",
  "/api/production/assets/updateAssetsUrl",
]);

const scriptIdFromIdRoutes = new Set(["/api/script/delScript", "/api/script/exportScript", "/api/script/pollScriptAssets", "/api/script/updateScript"]);

const storyboardIdFromIdRoutes = new Set([
  "/api/production/storyboard/batchDelete",
  "/api/production/storyboard/editStoryboardInfo",
  "/api/production/storyboard/pollingImage",
  "/api/production/storyboard/removeFrame",
  "/api/production/storyboard/updateStoryboardUrl",
]);

const novelIdFromIdRoutes = new Set(["/api/novel/batchDeleteNovel", "/api/novel/delNovel", "/api/novel/getNovelEventState", "/api/novel/updateNovel"]);
const eventIdFromIdRoutes = new Set(["/api/novel/event/batchDeleteEvent", "/api/novel/event/deletEvent"]);
const imageIdFromIdRoutes = new Set(["/api/assets/delImage", "/api/assetsGenerate/cancelGenerate"]);
const videoIdFromIdRoutes = new Set(["/api/production/workbench/delVideo"]);
const videoTrackIdFromIdRoutes = new Set(["/api/production/workbench/deleteTrack", "/api/production/workbench/updateVideoDuration", "/api/production/workbench/updateVideoPrompt"]);
const flowIdFromIdRoutes = new Set(["/api/production/editImage/getImageFlow"]);
const agentWorkDataIdFromIdRoutes = new Set(["/api/scriptAgent/updateData"]);
const scriptAssetsFieldRoutes = new Set(["/api/script/addScript", "/api/script/updateScript"]);

interface ResourceProjectIds {
  directProjectIds: Set<number>;
  assetIds: Set<number>;
  scriptIds: Set<number>;
  storyboardIds: Set<number>;
  novelIds: Set<number>;
  eventIds: Set<number>;
  imageIds: Set<number>;
  videoIds: Set<number>;
  videoTrackIds: Set<number>;
  taskIds: Set<number>;
  flowIds: Set<number>;
  agentWorkDataIds: Set<number>;
}

function getApiPath(req: Request) {
  return req.path.startsWith("/api/") ? req.path : `/api${req.path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePositiveId(value: unknown): number | null {
  if (typeof value === "number" || typeof value === "string") {
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  return null;
}

function collectPositiveIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectPositiveIds(item));
  const id = normalizePositiveId(value);
  return id ? [id] : [];
}

function addIds(target: Set<number>, ids: number[]) {
  ids.forEach((id) => target.add(id));
}

function collectIdsFromKeys(req: Request, keys: string[]): number[] {
  const records = [asRecord(req.body), asRecord(req.query)];
  return keys.flatMap((key) => records.flatMap((record) => collectPositiveIds(record[key])));
}

function collectNestedIdsByKey(value: unknown, key: string): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectNestedIdsByKey(item, key));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [...collectPositiveIds(record[key]), ...Object.values(record).flatMap((item) => collectNestedIdsByKey(item, key))];
}

function collectSourceScopedIds(value: unknown, resourceIds: ResourceProjectIds) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSourceScopedIds(item, resourceIds));
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const source = String(record.sources || record.source || "");
  const ids = collectPositiveIds(record.id);
  if (source === "assets" || source === "asset") addIds(resourceIds.assetIds, ids);
  if (source === "storyboard") addIds(resourceIds.storyboardIds, ids);

  Object.values(record).forEach((item) => collectSourceScopedIds(item, resourceIds));
}

function collectRequestResourceIds(req: Request): ResourceProjectIds {
  const apiPath = getApiPath(req);
  const body = asRecord(req.body);
  const query = asRecord(req.query);
  const resourceIds: ResourceProjectIds = {
    directProjectIds: new Set(),
    assetIds: new Set(),
    scriptIds: new Set(),
    storyboardIds: new Set(),
    novelIds: new Set(),
    eventIds: new Set(),
    imageIds: new Set(),
    videoIds: new Set(),
    videoTrackIds: new Set(),
    taskIds: new Set(),
    flowIds: new Set(),
    agentWorkDataIds: new Set(),
  };

  addIds(resourceIds.directProjectIds, collectIdsFromKeys(req, ["projectId"]));
  addIds(resourceIds.assetIds, collectIdsFromKeys(req, ["assetIds", "assetsId", "assetsIds"]));
  addIds(resourceIds.assetIds, collectNestedIdsByKey(body, "associateAssetsIds"));
  addIds(resourceIds.assetIds, collectNestedIdsByKey(query, "associateAssetsIds"));
  addIds(resourceIds.scriptIds, collectIdsFromKeys(req, ["scriptId", "scriptIds"]));
  addIds(resourceIds.storyboardIds, collectIdsFromKeys(req, ["storyboardIds"]));
  addIds(resourceIds.novelIds, collectIdsFromKeys(req, ["novelIds"]));
  addIds(resourceIds.imageIds, collectIdsFromKeys(req, ["imageId", "imageIds"]));
  addIds(resourceIds.videoIds, collectIdsFromKeys(req, ["videoId", "videoIds"]));
  addIds(resourceIds.videoTrackIds, collectIdsFromKeys(req, ["trackId", "trackIds"]));
  addIds(resourceIds.videoTrackIds, collectNestedIdsByKey(body, "trackId"));
  addIds(resourceIds.videoTrackIds, collectNestedIdsByKey(query, "trackId"));
  addIds(resourceIds.taskIds, collectIdsFromKeys(req, ["taskId", "taskIds"]));
  addIds(resourceIds.flowIds, collectIdsFromKeys(req, ["flowId", "flowIds"]));

  collectSourceScopedIds(body, resourceIds);
  collectSourceScopedIds(query, resourceIds);

  if (projectIdFromIdRoutes.has(apiPath)) addIds(resourceIds.directProjectIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (assetIdFromIdRoutes.has(apiPath)) addIds(resourceIds.assetIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (scriptAssetsFieldRoutes.has(apiPath)) addIds(resourceIds.assetIds, collectIdsFromKeys(req, ["assets"]));
  if (apiPath === "/api/assets/updateAudioAssets") {
    addIds(resourceIds.assetIds, collectNestedIdsByKey(body.assetsItem, "id"));
    addIds(resourceIds.assetIds, collectNestedIdsByKey(query.assetsItem, "id"));
  }
  if (apiPath === "/api/assetsGenerate/batchGenerateImageAssets") {
    addIds(resourceIds.assetIds, collectNestedIdsByKey(body.items, "id"));
    addIds(resourceIds.assetIds, collectNestedIdsByKey(query.items, "id"));
  }
  if (scriptIdFromIdRoutes.has(apiPath)) addIds(resourceIds.scriptIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (apiPath === "/api/production/getFlowData" || apiPath === "/api/production/saveFlowData") {
    addIds(resourceIds.scriptIds, collectIdsFromKeys(req, ["episodesId"]));
  }
  if (storyboardIdFromIdRoutes.has(apiPath)) addIds(resourceIds.storyboardIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (novelIdFromIdRoutes.has(apiPath)) addIds(resourceIds.novelIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (eventIdFromIdRoutes.has(apiPath)) addIds(resourceIds.eventIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (imageIdFromIdRoutes.has(apiPath)) addIds(resourceIds.imageIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (videoIdFromIdRoutes.has(apiPath)) addIds(resourceIds.videoIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (videoTrackIdFromIdRoutes.has(apiPath)) addIds(resourceIds.videoTrackIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (flowIdFromIdRoutes.has(apiPath)) addIds(resourceIds.flowIds, collectIdsFromKeys(req, ["id", "ids"]));
  if (agentWorkDataIdFromIdRoutes.has(apiPath)) addIds(resourceIds.agentWorkDataIds, collectIdsFromKeys(req, ["id", "ids"]));

  return resourceIds;
}

function projectIdFromRow(row: Record<string, unknown>): number | null {
  const projectId = normalizePositiveId(row.projectId);
  return projectId;
}

function uniqueIds(ids: Set<number>) {
  return Array.from(ids);
}

async function addTableProjectIds(projectIds: Set<number>, table: string, idColumn: string, ids: Set<number>) {
  const list = uniqueIds(ids);
  if (!list.length) return;
  const rows = (await u.db(table).whereIn(idColumn, list).select("projectId")) as Record<string, unknown>[];
  rows.forEach((row) => {
    const projectId = projectIdFromRow(row);
    if (projectId) projectIds.add(projectId);
  });
}

async function addImageProjectIds(projectIds: Set<number>, imageIds: Set<number>) {
  const list = uniqueIds(imageIds);
  if (!list.length) return;
  const rows = (await u
    .db("o_image")
    .leftJoin("o_assets", "o_image.assetsId", "o_assets.id")
    .whereIn("o_image.id", list)
    .select("o_assets.projectId as projectId")) as Record<string, unknown>[];
  rows.forEach((row) => {
    const projectId = projectIdFromRow(row);
    if (projectId) projectIds.add(projectId);
  });
}

async function addEventProjectIds(projectIds: Set<number>, eventIds: Set<number>) {
  const list = uniqueIds(eventIds);
  if (!list.length) return;
  const rows = (await u
    .db("o_eventChapter")
    .leftJoin("o_novel", "o_eventChapter.novelId", "o_novel.id")
    .whereIn("o_eventChapter.eventId", list)
    .select("o_novel.projectId as projectId")) as Record<string, unknown>[];
  rows.forEach((row) => {
    const projectId = projectIdFromRow(row);
    if (projectId) projectIds.add(projectId);
  });
}

async function addFlowProjectIds(projectIds: Set<number>, flowIds: Set<number>) {
  const list = uniqueIds(flowIds);
  if (!list.length) return;
  const [assetRows, storyboardRows] = (await Promise.all([
    u.db("o_assets").whereIn("flowId", list).select("projectId"),
    u.db("o_storyboard").whereIn("flowId", list).select("projectId"),
  ])) as Record<string, unknown>[][];
  [...assetRows, ...storyboardRows].forEach((row) => {
    const projectId = projectIdFromRow(row);
    if (projectId) projectIds.add(projectId);
  });
}

async function getProjectIdsForAuth(req: Request): Promise<number[]> {
  const resourceIds = collectRequestResourceIds(req);
  const projectIds = new Set(resourceIds.directProjectIds);
  await Promise.all([
    addTableProjectIds(projectIds, "o_assets", "id", resourceIds.assetIds),
    addTableProjectIds(projectIds, "o_script", "id", resourceIds.scriptIds),
    addTableProjectIds(projectIds, "o_storyboard", "id", resourceIds.storyboardIds),
    addTableProjectIds(projectIds, "o_novel", "id", resourceIds.novelIds),
    addTableProjectIds(projectIds, "o_video", "id", resourceIds.videoIds),
    addTableProjectIds(projectIds, "o_videoTrack", "id", resourceIds.videoTrackIds),
    addTableProjectIds(projectIds, "o_tasks", "id", resourceIds.taskIds),
    addTableProjectIds(projectIds, "o_agentWorkData", "id", resourceIds.agentWorkDataIds),
    addImageProjectIds(projectIds, resourceIds.imageIds),
    addEventProjectIds(projectIds, resourceIds.eventIds),
    addFlowProjectIds(projectIds, resourceIds.flowIds),
  ]);
  return uniqueIds(projectIds);
}

async function assertProjectAccess(req: Request, res: Response, userId: number): Promise<boolean> {
  const projectIds = await getProjectIdsForAuth(req);
  if (!projectIds.length) return true;
  const projects = (await u.db("o_project").whereIn("id", projectIds).select("id", "userId")) as Record<string, unknown>[];
  const projectById = new Map(projects.map((project) => [Number(project.id), project]));

  for (const projectId of projectIds) {
    const project = projectById.get(projectId);
    if (!project) {
      res.status(404).send({ message: "项目不存在" });
      return false;
    }
    if (project.userId != null && Number(project.userId) !== userId) {
      res.status(403).send({ message: "无权访问该项目" });
      return false;
    }
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
    if (apiPath === "/api/login/login" || apiPath === "/api/model-service/login") return next();

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

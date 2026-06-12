import { GlobalContext } from "@/socket/type";
import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import { ChatMessagesData } from "@/socket/chatMessagesData";
import * as agent from "@/agents/productionAgent/index";
import ChatKit from "@/socket/chatKit";
import { AuthUser, normalizeAuthUser, runWithUser } from "@/utils/requestContext";
import { buildAgentMemoryIsolationKey } from "@/utils/agent/isolation";

async function verifyToken(rawToken: string): Promise<AuthUser | null> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return null;
  const { value: tokenKey } = setting;
  if (!rawToken) return null;
  const token = rawToken.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, tokenKey as string);
    return normalizeAuthUser(decoded) ?? null;
  } catch (err) {
    return null;
  }
}

function parseProjectId(value: unknown): number | null {
  const projectId = Number(value);
  return Number.isFinite(projectId) && projectId > 0 ? projectId : null;
}

function normalizeChatText(payload: string | { content?: string }) {
  return typeof payload === "string" ? payload : payload?.content ?? "";
}

function parseEpisodesId(value: unknown): number | null {
  const episodesId = Number(value);
  return Number.isFinite(episodesId) && episodesId > 0 ? episodesId : null;
}

function buildIsolationKey(authUser: AuthUser, projectId: number, episodesId: number | null) {
  return buildAgentMemoryIsolationKey({
    agentType: "productionAgent",
    projectId,
    episodesId,
    user: authUser,
  });
}

async function canAccessProject(authUser: AuthUser, projectId: number): Promise<boolean> {
  const project = await u.db("o_project").where("id", projectId).select("id", "userId").first();
  if (!project) return false;
  return project.userId == null || Number(project.userId) === authUser.id;
}

function createThrottledMessageSync(socket: Socket, intervalMs = 120) {
  let latestMessages: ChatMessagesData[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitAt = 0;

  const emit = () => {
    if (!latestMessages) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastEmitAt = Date.now();
    socket.emit("syncMessages", latestMessages);
    latestMessages = null;
  };

  return {
    schedule(messages: ChatMessagesData[]) {
      latestMessages = messages;
      const waitMs = Math.max(0, intervalMs - (Date.now() - lastEmitAt));
      if (waitMs === 0) {
        emit();
        return;
      }
      if (!timer) timer = setTimeout(emit, waitMs);
    },
    flush() {
      emit();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      latestMessages = null;
    },
  };
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    const authUser = token ? await verifyToken(token) : null;
    if (!authUser) {
      console.log("[productionAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }

    const projectId = parseProjectId(socket.handshake.auth.projectId);
    const episodesId = parseEpisodesId(socket.handshake.auth.episodesId);
    const hasProjectAccess = projectId ? await canAccessProject(authUser, projectId) : false;
    const initialProjectId = hasProjectAccess ? projectId : null;
    const isolationKey = initialProjectId ? buildIsolationKey(authUser, initialProjectId, episodesId) : "";

    console.log("[productionAgent] 已连接:", {
      socketId: socket.id,
      userId: authUser.id,
      projectId: initialProjectId,
      requestedProjectId: projectId,
      episodesId,
      isolationKey,
    });
    const messageSync = createThrottledMessageSync(socket);
    let chatQueue: Promise<void> = Promise.resolve();
    let queuedJobs = 0;

    const globalContext: GlobalContext = {
      remoteTools: [],
      abortSignal: new AbortController(),
      socket,
      kit: undefined as any,
      isolationKey,
      projectId: initialProjectId ?? 0,
      thinkLevel: 0,
      messages: [],
    };

    const bindChatKit = () => {
      globalContext.kit = new ChatKit(globalContext.messages, {
        onChange: (messages: ChatMessagesData[]) => messageSync.schedule(messages),
      });
    };
    bindChatKit();

    socket.on("remoteTools", async (remoteTools) => {
      globalContext.remoteTools = Array.isArray(remoteTools) ? remoteTools : [];
      console.log("[productionAgent] 已接收远端工具:", {
        socketId: socket.id,
        userId: authUser.id,
        count: globalContext.remoteTools.length,
      });
    });

    socket.on("syncMessages", (messages: ChatMessagesData[]) => {
      messageSync.cancel();
      globalContext.messages = Array.isArray(messages) ? messages : [];
      console.log("[productionAgent] 已同步前端消息:", {
        socketId: socket.id,
        userId: authUser.id,
        count: globalContext.messages.length,
      });
      bindChatKit();
    });

    socket.on("updateContext", async (data: { isolationKey?: string; projectId?: number; episodesId?: number }, callback) => {
      const nextProjectId = parseProjectId(data?.projectId);
      if (!nextProjectId) {
        const message = "缺少有效 projectId，无法更新生产 Agent 上下文";
        console.warn("[productionAgent] 上下文更新失败:", { socketId: socket.id, userId: authUser.id, data });
        callback?.({ success: false, message });
        globalContext.kit.box().name("导演").text(message).end("error");
        messageSync.flush();
        return;
      }
      if (!(await canAccessProject(authUser, nextProjectId))) {
        const message = "无权访问该项目，无法更新生产 Agent 上下文";
        console.warn("[productionAgent] 上下文更新失败，项目无权限:", { socketId: socket.id, userId: authUser.id, projectId: nextProjectId });
        callback?.({ success: false, message });
        globalContext.kit.box().name("导演").text(message).end("error");
        messageSync.flush();
        return;
      }

      const nextEpisodesId = parseEpisodesId(data?.episodesId);
      globalContext.projectId = nextProjectId;
      globalContext.isolationKey = buildIsolationKey(authUser, nextProjectId, nextEpisodesId);
      console.log("[productionAgent] 上下文已更新:", {
        socketId: socket.id,
        userId: authUser.id,
        projectId: globalContext.projectId,
        episodesId: nextEpisodesId,
        isolationKey: globalContext.isolationKey,
      });
      callback?.({ success: true, isolationKey: globalContext.isolationKey });
    });

    socket.on("updateThinkConfig", (data: { thinlLevel?: 0 | 1 | 2 | 3; thinkLevel?: 0 | 1 | 2 | 3 }) => {
      globalContext.thinkLevel = data.thinlLevel ?? data.thinkLevel ?? 0;
      console.log("[productionAgent] 更新思考等级:", globalContext.thinkLevel);
    });

    socket.on("stop", () => {
      globalContext.abortSignal.abort();
      messageSync.flush();
    });

    socket.on("disconnect", () => {
      messageSync.cancel();
    });

    socket.on("chat", (payload: string | { content?: string }) => {
      const text = normalizeChatText(payload).trim();
      if (!text) return;
      if (!globalContext.projectId || !globalContext.isolationKey) {
        const message = "生产 Agent 尚未拿到项目上下文，请先选择项目/剧集，或刷新工作台后重试。";
        console.warn("[productionAgent] 拒绝处理消息，缺少上下文:", {
          socketId: socket.id,
          userId: authUser.id,
          projectId: globalContext.projectId,
          isolationKey: globalContext.isolationKey,
          text: text.slice(0, 120),
        });
        globalContext.kit.user().text(text).end();
        globalContext.kit.box().name("导演").text(message).end("error");
        messageSync.flush();
        return;
      }
      console.log("[productionAgent] 收到消息:", {
        socketId: socket.id,
        userId: authUser.id,
        projectId: globalContext.projectId,
        isolationKey: globalContext.isolationKey,
        text: text.slice(0, 120),
      });

      const queuedAhead = queuedJobs;
      queuedJobs += 1;
      const userBox = globalContext.kit.user();
      userBox.text(text).end();
      if (queuedAhead > 0) {
        globalContext.kit
          .box()
          .name("导演")
          .text(`已收到，会在当前任务结束后继续处理。前方还有 ${queuedAhead} 条消息。`)
          .end();
      }
      messageSync.flush();

      chatQueue = chatQueue
        .catch((err) => {
          console.error("[productionAgent] queue error:", u.error(err).message);
        })
        .then(async () => {
          const abortSignal = new AbortController();
          globalContext.abortSignal = abortSignal;
          try {
            await runWithUser(authUser, async () => {
              await agent.runDecisionAI(globalContext, text);
            });
          } catch (err: any) {
            if (err?.name !== "AbortError" && !abortSignal.signal.aborted) {
              const message = u.error(err).message;
              console.error("[productionAgent] chat error:", message);
              globalContext.kit.box().name("导演").text(message).end("error");
            }
          } finally {
            queuedJobs = Math.max(0, queuedJobs - 1);
            messageSync.flush();
          }
        });
    });
  });

  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};

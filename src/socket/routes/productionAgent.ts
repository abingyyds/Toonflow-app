import { GlobalContext } from "@/socket/type";
import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import { ChatMessagesData } from "@/socket/chatMessagesData";
import * as agent from "@/agents/productionAgent/index";
import ChatKit from "@/socket/chatKit";
import { AuthUser, normalizeAuthUser, runWithUser } from "@/utils/requestContext";

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

function parseProjectId(value: unknown) {
  const projectId = Number(value);
  return Number.isFinite(projectId) && projectId > 0 ? projectId : 1777638289380;
}

function normalizeChatText(payload: string | { content?: string }) {
  return typeof payload === "string" ? payload : payload?.content ?? "";
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

    const isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[productionAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[productionAgent] 已连接:", socket.id);
    const messageSync = createThrottledMessageSync(socket);
    let chatQueue: Promise<void> = Promise.resolve();
    let queuedJobs = 0;

    const globalContext: GlobalContext = {
      remoteTools: [],
      abortSignal: new AbortController(),
      socket,
      kit: undefined as any,
      isolationKey,
      projectId: parseProjectId(socket.handshake.auth.projectId),
      thinkLevel: 0,
      messages: [],
    };

    const bindChatKit = () => {
      globalContext.kit = new ChatKit(globalContext.messages, {
        onChange: (messages: ChatMessagesData[]) => messageSync.schedule(messages),
      });
    };
    bindChatKit();

    socket.on("remoteTools", async (remoteTools) => (globalContext.remoteTools = remoteTools));

    socket.on("syncMessages", (messages: ChatMessagesData[]) => {
      messageSync.cancel();
      globalContext.messages = Array.isArray(messages) ? messages : [];
      bindChatKit();
    });

    socket.on("updateContext", (data: { isolationKey?: string; projectId?: number }, callback) => {
      if (data?.isolationKey) globalContext.isolationKey = data.isolationKey;
      if (data?.projectId) globalContext.projectId = parseProjectId(data.projectId);
      console.log("[productionAgent] 上下文已更新:", globalContext.isolationKey);
      callback?.({ success: true });
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
      console.log("[productionAgent] 收到消息:", text.slice(0, 120));

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

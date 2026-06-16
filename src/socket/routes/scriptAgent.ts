import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/scriptAgent/index";
import ResTool from "@/socket/resTool";
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

async function canAccessProject(authUser: AuthUser, projectId: number): Promise<boolean> {
  const project = await u.db("o_project").where("id", projectId).select("id", "userId").first();
  if (!project) return false;
  return project.userId == null || Number(project.userId) === authUser.id;
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    const authUser = token ? await verifyToken(token) : null;
    if (!authUser) {
      console.log("[scriptAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    const projectId = parseProjectId(socket.handshake.auth.projectId);
    if (!projectId) {
      console.log("[scriptAgent] 连接失败，缺少 projectId");
      socket.disconnect();
      return;
    }
    if (!(await canAccessProject(authUser, projectId))) {
      console.log("[scriptAgent] 连接失败，项目无权限", { userId: authUser.id, projectId });
      socket.disconnect();
      return;
    }
    const isolationKey = buildAgentMemoryIsolationKey({
      agentType: "scriptAgent",
      projectId,
      user: authUser,
    });

    console.log("[scriptAgent] 已连接:", { socketId: socket.id, userId: authUser.id, projectId, isolationKey });

    const resTool = new ResTool(socket, {
      projectId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("chat", async (data: { content: string }) => runWithUser(authUser, async () => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[scriptAgent] chat error:", u.error(err).message);
          msg.error(u.error(err).message);
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    }));

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[scriptAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[scriptAgent] 已断开连接:", socket.id);
  });
};

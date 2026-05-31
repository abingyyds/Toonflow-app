import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import { ChatMessagesData } from "@/socket/chatMessagesData";
import * as agent from "@/agents/productionAgent/index";

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

interface GlobalContext {
  messages: ChatMessagesData[];
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    console.log("[productionAgent] 已连接:", socket.id);

    const globalContext: GlobalContext = {
      messages: [],
    };

    socket.on("syncMessages", (messages: ChatMessagesData[]) => (globalContext.messages = messages));

    socket.on("chat", async (data: { content: string }) => {
      agent.runDecisionAI(globalContext)

    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};

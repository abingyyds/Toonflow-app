import { z } from "zod";
import ChatKit from "@/socket/chatKit";
import { ChatMessagesData } from "@/socket/chatMessagesData";
import { Socket } from "socket.io";

export type RemoteToolsListItem = {
  path: string;
  description: string;
  jsonSchema: z.core.ZodStandardJSONSchemaPayload<any> | null;
};

export interface GlobalContext {
  remoteTools: RemoteToolsListItem[];
  abortSignal: AbortController;
  socket: Socket;
  kit: ChatKit;
  isolationKey: string;
  projectId: number;
  thinkLevel: 0 | 1 | 2 | 3;
  messages: ChatMessagesData[];
}

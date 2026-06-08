import { GlobalContext } from "@/socket/type";
import { z } from "zod";
import { tool } from "ai";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import * as fs from "fs";
import path from "path";

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

export async function runDecisionAI(ctx: GlobalContext, text: string) {
  const memory = new Memory("productionAgent", ctx.isolationKey);
  await memory.add("user", text);

  const skill = path.join(u.getPath("skills"), "production_agent_decision.md");
  const prompt = await fs.promises.readFile(skill, "utf-8");

  const projectInfo = await u.db("o_project").where("id", ctx.projectId).first();
  if (!projectInfo) throw new Error(`项目不存在，ID: ${ctx.projectId}`);
  const [_, imageModelName] = projectInfo.imageModel!.split(/:(.+)/);
  const [id, videoModelName] = projectInfo.videoModel!.split(/:(.+)/);
  const models = await u.vendor.getModelList(id);
  if (!models.length) throw new Error(`项目使用的模型不存在，ID: ${projectInfo.videoModel}`);
  let videoMode = "";
  try {
    videoMode = JSON.parse(projectInfo.mode ?? "");
  } catch (e) {
    videoMode = projectInfo.mode ?? "";
  }
  const isRef = Array.isArray(videoMode) ? true : false;
  // const findData = models.find((i: any) => i.modelName == videoModelName);
  // const isRef = findData.mode.every((i: any) => Array.isArray(i));

  const modelInfo = `项目使用的模型如下：\n图像模型：${imageModelName}\n视频模型：${videoModelName}\n多参：${isRef ? "是" : "否"}`;

  const mem = buildMemPrompt(await memory.get(text));

  const { fullStream } = await u.Ai.Text("productionAgent", ctx.thinkLevel).stream({
    messages: [
      // { role: "system", content: prompt },
      // { role: "assistant", content: mem + "\n" + modelInfo },
      { role: "user", content: text },
    ],
    abortSignal: ctx.abortSignal.signal,
    tools: {
      ...memory.getTools(),
      // ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      subAgent: subAgent(ctx),
    },
  });
  return consumeStream(ctx, fullStream, "导演");
}

function subAgent(ctx: GlobalContext) {
  return tool({
    description: "运行执行subAgent来完成相关任务",
    inputSchema: z.object({
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    }),
    execute: async ({ prompt }) => {
      const remoteToolsString = ctx.remoteTools
        .map((t) => {
          return `工具名称：${t.path}\n工具描述：${t.description}\n工具参数：${t.jsonSchema ? JSON.stringify(t.jsonSchema) : "无"}`;
        })
        .join("\n\n");
      const systemPrompt = `你可以使用runRemoteTool工具运行如下方法：\n\n${remoteToolsString}\n\n当你需要使用工具时，调用runRemoteTools并传入工具名称和字符串参数即可。`;

      const { fullStream } = await u.Ai.Text("productionAgent", ctx.thinkLevel).stream({
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
        tools: {
          runRemoteTool: runRemoteTool(ctx),
        },
      });
      const result = await consumeStream(ctx, fullStream, "执行");
      return result;
    },
  });
}

async function consumeStream(ctx: GlobalContext, fullStream: AsyncIterable<any>, name: string): Promise<string> {
  let box: ReturnType<typeof ctx.kit.box> | null = null;
  let decisionMsg: any = null;
  let thinking: any = null;
  let thinkTime = 0;
  let fullResponse = "";

  // 容器可以早建：进流之前就显示一条 loading 占位消息
  const startBox = () => {
    box = ctx.kit.box().name(name).status("pending"); // pending = loading
    decisionMsg = null;
    thinking = null;
  };
  // 第一个内容块到了才把消息切到 streaming（内容块本身仍懒建，保证顺序）
  const liveBox = () => {
    if (!box) startBox();
    box!.status("streaming");
    return box!;
  };
  const flushStep = () => {
    if (box) {
      const empty = !(box.raw() as any).content?.length;
      if (empty) box.remove(); // 这一步没产出 → 删掉空 loading 消息
      else {
        decisionMsg?.end();
        box.end();
      } // 否则收尾并标 complete
    }
    box = null;
    decisionMsg = null;
    thinking = null;
  };

  startBox(); // ← 关键：先把 loading 显示出来，不再等数据

  for await (const chunk of fullStream) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    if (chunk.type === "start-step") {
      if (!box) startBox(); // 下一步重新显示 loading
    } else if (chunk.type === "reasoning-start") {
      thinkTime = Date.now();
      thinking = liveBox().thinking("思考中...");
    } else if (chunk.type === "reasoning-delta") {
      thinking?.append(chunk.text);
    } else if (chunk.type === "reasoning-end") {
      thinkTime = Date.now() - thinkTime;
      thinking?.title(`思考完毕（${(thinkTime / 1000).toFixed(1)} 秒）`).end();
      thinking = null;
    } else if (chunk.type === "text-delta") {
      if (!decisionMsg) decisionMsg = liveBox().text();
      decisionMsg.append(chunk.text);
      fullResponse += chunk.text;
    } else if (chunk.type === "finish-step") {
      flushStep();
    } else if (chunk.type === "error") {
      throw chunk.error;
    }
  }
  flushStep();
  return fullResponse;
}

function runRemoteTool(ctx: GlobalContext) {
  return tool({
    description: "运行远端工具",
    inputSchema: z.object({
      name: z.string().describe("工具名称"),
      args: z.string().describe("工具参数"),
    }),
    execute: async ({ name, args }) => {
      return await new Promise((resolve, reject) =>
        ctx.socket.emit("runRemoteTool", { name, args }, (res: { state: "success" | "error"; result?: any; error?: string }) => {
          if (res.state === "error") reject(new Error(res.error));
          else resolve(res.result);
        }),
      );
    },
  });
}

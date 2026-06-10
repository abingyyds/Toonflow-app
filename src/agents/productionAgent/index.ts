import { GlobalContext } from "@/socket/type";
import { z } from "zod";
import { tool } from "ai";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import * as fs from "fs";
import path from "path";

type ProductionFlowDataKey = "script" | "scriptPlan" | "plan" | "storyboardTable" | "assets" | "storyboard" | "workbench" | "all";

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
  const decisionPrompt = `${prompt}

## 当前产品入口语义

当用户点击「开始制作视频」或输入「请帮我开始制作视频」时，含义是「从头开始 / 完整制作」，应从阶段1导演规划开始按流水线推进。
这不是视频生成面板里的最终合成视频请求，不要按“生成视频/合成视频”拒绝执行。`;

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
      { role: "system", content: decisionPrompt },
      { role: "assistant", content: mem + "\n\n" + modelInfo },
      { role: "user", content: text },
    ],
    abortSignal: ctx.abortSignal.signal,
    tools: {
      ...memory.getTools(),
      ...createSubAgentTools(ctx),
    },
  });
  const fullResponse = await consumeStream(ctx, fullStream, "导演");
  if (fullResponse.trim()) await memory.add("assistant:decision", fullResponse);
  return fullResponse;
}

function createSubAgentTools(ctx: GlobalContext) {
  const promptInput = z.object({
    prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
  });

  return {
    run_sub_agent_director_plan: createStageTool(ctx, {
      key: "productionAgent:directorPlanAgent",
      skillFile: "production_execution_director_plan.md",
      name: "导演规划",
      description: "运行执行层Agent完成阶段1：导演规划（含衍生资产预划）",
      inputSchema: promptInput,
    }),
    run_sub_agent_derive_assets: createStageTool(ctx, {
      key: "productionAgent:deriveAssetsAgent",
      skillFile: "production_execution_derive_assets.md",
      name: "衍生资产",
      description: "运行执行层Agent完成阶段2：衍生资产分析与写入",
      inputSchema: promptInput,
    }),
    run_sub_agent_generate_assets: createStageTool(ctx, {
      key: "productionAgent:generateAssetsAgent",
      skillFile: "production_execution_generate_assets.md",
      name: "资产生成",
      description: "运行执行层Agent完成阶段3：衍生资产图片生成",
      inputSchema: promptInput,
    }),
    run_sub_agent_storyboard_table: createStageTool(ctx, {
      key: "productionAgent:storyboardTableAgent",
      skillFile: "production_execution_storyboard_table.md",
      name: "分镜表",
      description: "运行执行层Agent完成阶段4：构建结构化分镜表",
      inputSchema: promptInput,
    }),
    run_sub_agent_storyboard_panel: createStageTool(ctx, {
      key: "productionAgent:storyboardPanelAgent",
      skillFile: "production_execution_storyboard_panel.md",
      name: "分镜面板",
      description: "运行执行层Agent完成阶段5：分镜面板写入",
      inputSchema: promptInput,
    }),
    run_sub_agent_storyboard_gen: createStageTool(ctx, {
      key: "productionAgent:storyboardGenAgent",
      skillFile: "production_execution_storyboard_gen.md",
      name: "分镜图",
      description: "运行执行层Agent完成阶段6：分镜图生成",
      inputSchema: promptInput,
    }),
    run_sub_agent_supervision: createStageTool(ctx, {
      key: "productionAgent:supervisionAgent",
      skillFile: "production_agent_supervision.md",
      name: "监督",
      description: "运行监督层Agent审核当前阶段产出物",
      inputSchema: promptInput,
    }),
  };
}

function createStageTool(
  ctx: GlobalContext,
  config: {
    key: Parameters<typeof u.Ai.Text>[0];
    skillFile: string;
    name: string;
    description: string;
    inputSchema: z.ZodType<{ prompt: string }>;
  },
) {
  return tool({
    description: config.description,
    inputSchema: config.inputSchema,
    execute: async ({ prompt }) => {
      const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), config.skillFile), "utf-8");
      const { fullStream } = await u.Ai.Text(config.key, ctx.thinkLevel).stream({
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
        abortSignal: ctx.abortSignal.signal,
        tools: createProductionRemoteTools(ctx),
      });
      return consumeStream(ctx, fullStream, config.name);
    },
  });
}

function createProductionRemoteTools(ctx: GlobalContext) {
  return {
    get_flowData: tool({
      description: "读取生产工作区数据。key 可为 script、assets、scriptPlan/plan、storyboardTable、storyboard、workbench、all。",
      inputSchema: z.object({
        key: z.enum(["script", "scriptPlan", "plan", "storyboardTable", "assets", "storyboard", "workbench", "all"]).default("all"),
      }),
      execute: async ({ key }) => {
        const data = await emitRemoteTool<Record<string, any>>(ctx, "getFlowData", {});
        return pickFlowData(data, key);
      },
    }),
    add_deriveAsset: tool({
      description: "新增或更新一个衍生资产。",
      inputSchema: z.object({
        assetsId: z.number().describe("父资产ID"),
        id: z.number().nullable().optional().describe("已有衍生资产ID；新增时可为空"),
        name: z.string().describe("衍生资产名称"),
        desc: z.string().optional().describe("衍生资产描述"),
        describe: z.string().optional().describe("衍生资产描述"),
        type: z.string().optional().describe("资产类型"),
      }),
      execute: async (input) =>
        emitRemoteTool(ctx, "addDeriveAsset", {
          ...input,
          describe: input.describe ?? input.desc ?? "",
        }),
    }),
    del_deriveAsset: tool({
      description: "删除一个衍生资产。",
      inputSchema: z.object({
        assetsId: z.number().describe("父资产ID"),
        id: z.number().describe("衍生资产ID"),
      }),
      execute: async (input) => emitRemoteTool(ctx, "delDeriveAsset", input),
    }),
    generate_assets_images: tool({
      description: "对指定衍生资产ID发起图片生成任务。",
      inputSchema: z.object({
        ids: z.array(z.number()).describe("需要生成图片的衍生资产ID列表"),
      }),
      execute: async (input) => emitRemoteTool(ctx, "generateDeriveAsset", input),
    }),
    generate_storyboard_images: tool({
      description: "对指定分镜ID发起分镜图生成任务。",
      inputSchema: z.object({
        ids: z.array(z.number()).describe("需要生成分镜图的分镜ID列表"),
      }),
      execute: async (input) => emitRemoteTool(ctx, "generateStoryboard", input),
    }),
  };
}

function pickFlowData(data: Record<string, any>, key: ProductionFlowDataKey) {
  if (!key || key === "all") return data;
  const normalizedKey = key === "plan" ? "scriptPlan" : key;
  return data?.[normalizedKey];
}

function emitRemoteTool<T = any>(ctx: GlobalContext, event: string, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`远端工具 ${event} 调用超时`)), 120000);
    ctx.socket.emit(event, payload, (res: any) => {
      clearTimeout(timer);
      if (res?.state === "error") {
        reject(new Error(res.error || res.message || `${event} 调用失败`));
        return;
      }
      if (res?.success === false) {
        reject(new Error(res.message || `${event} 调用失败`));
        return;
      }
      resolve((res?.result ?? res?.data ?? res?.message ?? res) as T);
    });
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

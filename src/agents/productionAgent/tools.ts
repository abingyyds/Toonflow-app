import { GlobalContext } from "@/socket/type";

import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";

export default (ctx: GlobalContext) => {
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: z.string().describe("数据key"),
      }),
      execute: async ({ key }) => {
        return 123;
      },
    }),
  };
  return tools;
};

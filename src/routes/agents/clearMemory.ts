import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildAgentMemoryIsolationKeys } from "@/utils/agent/isolation";
import { getCurrentUser } from "@/utils/requestContext";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number().optional(),
    agentType: z.enum(["scriptAgent", "productionAgent"]),
    type: z.enum(["message", "summary", "all"]).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, agentType, type = "all" } = req.body;
    const isolationKeys = buildAgentMemoryIsolationKeys({
      agentType,
      projectId,
      episodesId,
      user: getCurrentUser(),
    });

    if (type === "all") {
      await u.db("memories").whereIn("isolationKey", isolationKeys).del();
    } else if (type === "message") {
      // 删 message 时同步删关联的 summary，避免悬挂引用
      await u.db("memories").whereIn("isolationKey", isolationKeys).andWhere({ type: "message" }).del();
      await u.db("memories").whereIn("isolationKey", isolationKeys).andWhere({ type: "summary" }).del();
    } else {
      // 删 summary 时将关联的 message 重置为未总结，使其重新进入 shortTerm
      await u
        .db("memories")
        .whereIn("isolationKey", isolationKeys)
        .andWhere({ type: "message", summarized: 1 })
        .update({ summarized: 0 });
      await u.db("memories").whereIn("isolationKey", isolationKeys).andWhere({ type: "summary" }).del();
    }

    res.status(200).send(success(null));
  },
);

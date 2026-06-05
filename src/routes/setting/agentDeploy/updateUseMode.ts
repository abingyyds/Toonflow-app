import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { setUserSetting } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    agentUseMode: z.string(),
  }),
  async (req, res) => {
    const { agentUseMode } = req.body;
    await setUserSetting("agentUseMode", agentUseMode);
    res.status(200).send(success("保存设置成功"));
  },
);

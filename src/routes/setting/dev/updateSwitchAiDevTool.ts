import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { setUserSetting } from "@/utils/userConfig";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    switchAiDevTool: z.string(),
  }),
  async (req, res) => {
    const { switchAiDevTool } = req.body;
    await setUserSetting("switchAiDevTool", switchAiDevTool);
    res.status(200).send(success("保存设置成功"));
  },
);

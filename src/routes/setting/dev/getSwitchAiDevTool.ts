import express from "express";
import { success } from "@/lib/responseFormat";
import { getUserSetting } from "@/utils/userConfig";

const router = express.Router();

export default router.get("/", async (req, res) => {
  const switchAiDevTool = await getUserSetting("switchAiDevTool", "0");
  res.status(200).send(success(switchAiDevTool || "0"));
});

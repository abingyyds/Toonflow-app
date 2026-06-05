import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { getUserSetting } from "@/utils/userConfig";

const router = express.Router();

export default router.get("/", async (req, res) => {
  const useMode = await getUserSetting("agentUseMode", "0");
  res.status(200).send(success(useMode));
});

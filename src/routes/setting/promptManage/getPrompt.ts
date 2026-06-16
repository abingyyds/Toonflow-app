import express from "express";
import { success } from "@/lib/responseFormat";
import { getEffectivePromptList, resolvePromptContent } from "@/utils/userConfig";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const list = await getEffectivePromptList();
  const data = list.map((item) => ({
    ...item,
    data: resolvePromptContent(item),
  }));
  res.status(200).send(success(data));
});

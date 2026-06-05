import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getEffectiveAgentDeployList } from "@/utils/userConfig";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const allData = await getEffectiveAgentDeployList();
  const qrdinaryData = allData.filter((item: any) => !item.key?.includes(":"));
  const advancedData = allData.filter((item: any) => item.key?.includes(":"));
  res.status(200).send(success({ qrdinaryData, advancedData }));
});

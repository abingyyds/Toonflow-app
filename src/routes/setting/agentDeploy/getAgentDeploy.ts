import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getEffectiveAgentDeployList } from "@/utils/userConfig";
import { toPublicModelId, toPublicVendorId } from "@/utils/vendorVisibility";
const router = express.Router();

function toPublicAgentDeploy(item: any) {
  return {
    ...item,
    modelName: toPublicModelId(item.modelName),
    vendorId: toPublicVendorId(item.vendorId),
  };
}

export default router.post("/", async (req, res) => {
  const allData = (await getEffectiveAgentDeployList()).map(toPublicAgentDeploy);
  const qrdinaryData = allData.filter((item: any) => !item.key?.includes(":"));
  const advancedData = allData.filter((item: any) => item.key?.includes(":"));
  res.status(200).send(success({ qrdinaryData, advancedData }));
});

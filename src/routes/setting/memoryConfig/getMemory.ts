import express from "express";
import { error, success } from "@/lib/responseFormat";
import { getUserSettings } from "@/utils/userConfig";
const router = express.Router();

export default router.get("/", async (req, res) => {
  try {
    const settingData = await getUserSettings({
      messagesPerSummary: "10",
      shortTermLimit: "5",
      summaryMaxLength: "500",
      summaryLimit: "10",
      ragLimit: "3",
      deepRetrieveSummaryLimit: "5",
      modelOnnxFile: '["all-MiniLM-L6-v2","onnx","model_fp16.onnx"]',
      modelDtype: "fp16",
    });
    const memoryObj: Record<string, number | string | string[]> = {};

    Object.entries(settingData).forEach(([key, raw]) => {
      let value: number | string | string[] = raw;
      if (key == "modelOnnxFile") {
        value = JSON.parse(raw);
      } else if (key != "modelDtype") {
        value = Number(raw);
      }
      memoryObj[key] = value;
    });

    res.status(200).send(success({ ...memoryObj }));
  } catch {
    return res.status(400).send(error(`获取记忆配置失败`));
  }
});

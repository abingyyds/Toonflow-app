import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { setUserSettings } from "@/utils/userConfig";
const router = express.Router();

// 获取用户
export default router.post(
  "/",
  validateFields({
    messagesPerSummary: z.number(),
    shortTermLimit: z.number(),
    summaryMaxLength: z.number(),
    summaryLimit: z.number(),
    ragLimit: z.number(),
    deepRetrieveSummaryLimit: z.number(),
    modelOnnxFile: z.array(z.string()),
    modelDtype: z.string(),
  }),
  async (req, res) => {
    const { messagesPerSummary, shortTermLimit, summaryMaxLength, summaryLimit, ragLimit, deepRetrieveSummaryLimit, modelOnnxFile, modelDtype } =
      req.body;

    await setUserSettings({
      messagesPerSummary: String(messagesPerSummary),
      shortTermLimit: String(shortTermLimit),
      summaryMaxLength: String(summaryMaxLength),
      summaryLimit: String(summaryLimit),
      ragLimit: String(ragLimit),
      deepRetrieveSummaryLimit: String(deepRetrieveSummaryLimit),
      modelOnnxFile: JSON.stringify(modelOnnxFile),
      modelDtype: modelDtype,
    });

    res.status(200).send(success("保存设置成功"));
  },
);

import express from "express";
import z from "zod";
import { validateFields } from "@/middleware/middleware";
import { error } from "@/lib/responseFormat";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    url: z.url(),
    reinstall: z.boolean(),
    version: z.string(),
  }),
  async (req, res) => {
    return res.status(403).send(error("当前定制版本已禁用自动更新"));
  },
);

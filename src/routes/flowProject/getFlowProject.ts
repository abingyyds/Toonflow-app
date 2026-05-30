import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

// 获取项目
export default router.post("/", async (req, res) => {
  const data = await u.db("o_flowProject").select("id", "createTime", "intro", "name");
  res.status(200).send(success(data));
});

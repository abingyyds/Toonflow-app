import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { getCurrentUserId } from "@/utils/requestContext";
const router = express.Router();

// 获取项目
export default router.post("/", async (req, res) => {
  const userId = getCurrentUserId();
  const query = u.db("o_project").select("*");
  if (userId) query.where("userId", userId);
  const data = await query;
  res.status(200).send(success(data));
});

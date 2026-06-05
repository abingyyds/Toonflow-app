import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { getCurrentUserId } from "@/utils/requestContext";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const userId = getCurrentUserId();
  const query = u.db("o_project").select("id", "name").groupBy("name");
  if (userId) query.where("userId", userId);
  const list = await query;
  const data = list.filter((item) => item.name);
  res.status(200).send(success(data));
});

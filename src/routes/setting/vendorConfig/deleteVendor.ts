import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import path from "path";
import fs from "fs";
import u from "@/utils";
import { z } from "zod";
import { getCurrentUserId } from "@/utils/requestContext";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const userId = getCurrentUserId();
    if (userId) {
      await u.db("o_userVendorConfig").where({ userId, vendorId: id }).delete();
      await u.db("o_userAgentDeploy").where({ userId, vendorId: id }).update({
        model: null,
        vendorId: null,
      });
      return res.status(200).send(success("删除成功"));
    }
    await u.db("o_vendorConfig").where("id", id).del();
    await u.db("o_agentDeploy").where("vendorId", id).update({
      model: null,
      vendorId: null,
    });
    fs.rmSync(path.join(u.getPath("vendor"), `${id}.ts`), { recursive: true, force: true });
    res.status(200).send(success("删除成功"));
  },
);

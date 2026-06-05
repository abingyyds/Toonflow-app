import express from "express";
import { success } from "@/lib/responseFormat";
import { getCurrentUserId } from "@/utils/requestContext";
import { getStoredSubrouterAccount } from "@/utils/subrouter";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const userId = getCurrentUserId();
  if (!userId) return res.status(401).send({ message: "未提供token" });
  const account = await getStoredSubrouterAccount(userId, req.body?.provider, req.body?.baseUrl);
  res.status(200).send(
    success({
      connected: Boolean(account),
      account: account
        ? {
            provider: account.provider,
            baseUrl: account.baseUrl,
            username: account.username,
            email: account.email,
            displayName: account.displayName,
            apiKeyReady: Boolean(account.apiKey),
            updatedTime: (account as any).updatedTime,
          }
        : null,
    }),
  );
});

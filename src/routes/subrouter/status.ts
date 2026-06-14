import express from "express";
import { success } from "@/lib/responseFormat";
import { getCurrentUser, getCurrentUserId } from "@/utils/requestContext";
import { getStoredSubrouterAccount } from "@/utils/subrouter";

const router = express.Router();

function parseModels(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function countModelsByType(models: Array<{ type?: string }>) {
  return models.reduce(
    (acc, model) => {
      const type = model.type === "image" || model.type === "video" || model.type === "text" ? model.type : "other";
      acc[type] += 1;
      return acc;
    },
    { text: 0, image: 0, video: 0, other: 0 },
  );
}

export default router.post("/", async (req, res) => {
  const user = getCurrentUser();
  const userId = getCurrentUserId();
  if (!userId) return res.status(401).send({ message: "未提供token" });
  const account = await getStoredSubrouterAccount(userId, req.body?.provider, req.body?.baseUrl);
  const models = parseModels(account?.models);
  res.status(200).send(
    success({
      user,
      connected: Boolean(account),
      account: account
        ? {
            provider: account.provider,
            baseUrl: account.baseUrl,
            username: account.username,
            email: account.email,
            displayName: account.displayName,
            distributorId: account.distributorId,
            distributorSlug: account.distributorSlug,
            distributorName: account.distributorName,
            apiKeyReady: Boolean(account.apiKey),
            updatedTime: (account as any).updatedTime,
          }
        : null,
      modelCount: models.length,
      modelStats: countModelsByType(models),
    }),
  );
});

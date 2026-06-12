import express from "express";
import logger from "@/logger";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();
const MAX_TAIL_BYTES = 1024 * 1024;

function parseTailBytes(value: unknown): number {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 200 * 1024;
  return Math.min(Math.floor(bytes), MAX_TAIL_BYTES);
}

export default router.get("/", (req, res) => {
  const tailBytes = parseTailBytes(req.query.tailBytes);
  const content = logger.exportLogs();
  const tail = content.length > tailBytes ? content.slice(content.length - tailBytes) : content;

  res.status(200).send(
    success({
      path: u.getPath("logs/app.log"),
      size: Buffer.byteLength(content, "utf-8"),
      tail,
    }),
  );
});

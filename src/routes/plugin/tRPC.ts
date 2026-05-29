
import express from "express";
import { error, success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

import pluginDB from "@/utils/umd/pluginDB";

// tRPC_DB
export default router.post(
  "/",
  validateFields({
    table: z.string().optional(),
    chain: z
      .array(
        z.object({
          method: z.string(),
          args: z.array(z.any()),
        }),
      )
      .default([]),
    raw: z
      .object({
        sql: z.string(),
        bindings: z.array(z.any()).optional(),
      })
      .optional(),
  }),
  async (req, res) => {
    try {
      const { table, chain, raw } = req.body;
      if (raw) {
        return res.json(await pluginDB.raw(raw.sql, raw.bindings));
      }
      let query: any = table ? pluginDB(table) : pluginDB;
      for (const { method, args } of chain) {
        query = typeof query[method] === "function" ? query[method](...args) : query[method];
      }
      res.json(await query);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

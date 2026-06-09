import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { getEffectiveVendorConfig } from "@/utils/userConfig";
import { ensureSubrouterVendor } from "@/utils/subrouter";
import { INTERNAL_ROUTER_VENDOR_ID, isHiddenBuiltInVendorId } from "@/utils/vendorVisibility";
const router = express.Router();

export default router.post("/", async (req, res) => {
  await ensureSubrouterVendor();
  const data = (await u.db("o_vendorConfig").select("*")).filter((item) => !isHiddenBuiltInVendorId(item.id));

  const list = (
    await Promise.all(
      data.map(async (item) => {
        let vendor;
        try {
          vendor = u.vendor.getVendor(item.id!);
        } catch {
          vendor = null;
        }
        if (!vendor) {
          await u.db("o_vendorConfig").where("id", item.id).delete();
          return null;
        }
        const effective = await getEffectiveVendorConfig(item.id!);
        return {
          ...item,
          ...(effective ?? {}),
          inputValues: JSON.parse(effective?.inputValues ?? "{}"),
          models: await u.vendor.getModelList(item.id!),
          code: u.vendor.getCode(item.id!),
          description: vendor.description ?? "",
          inputs: vendor.inputs,
          author: vendor.author,
          name: vendor.name,
          version: vendor.version ?? "1.0",
        };
      }),
    )
  ).filter((i) => Boolean(i));

  list.sort((a, b) => (a!.id === INTERNAL_ROUTER_VENDOR_ID ? -1 : b!.id === INTERNAL_ROUTER_VENDOR_ID ? 1 : 0));
  res.status(200).send(success(list));
});

export const INTERNAL_ROUTER_VENDOR_ID = "subrouter";

export const HIDDEN_BUILT_IN_VENDOR_IDS = [
  "toonflow",
  "toonflow2",
  "null",
  "bull",
] as const;

const hiddenBuiltInVendorIdSet = new Set<string>(HIDDEN_BUILT_IN_VENDOR_IDS);

export function isHiddenBuiltInVendorId(id: string | null | undefined): boolean {
  return typeof id === "string" && hiddenBuiltInVendorIdSet.has(id);
}

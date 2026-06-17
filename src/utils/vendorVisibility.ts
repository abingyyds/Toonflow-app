export const INTERNAL_ROUTER_VENDOR_ID = "subrouter";
export const PUBLIC_ROUTER_VENDOR_ID = "model-service";

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

export function toPublicVendorId(id: string | null | undefined): string {
  return id === INTERNAL_ROUTER_VENDOR_ID ? PUBLIC_ROUTER_VENDOR_ID : id || "";
}

export function toInternalVendorId(id: string | null | undefined): string {
  return id === PUBLIC_ROUTER_VENDOR_ID ? INTERNAL_ROUTER_VENDOR_ID : id || "";
}

export function toPublicModelId(modelId: string | null | undefined): string {
  if (!modelId) return "";
  return modelId.replace(new RegExp(`^${INTERNAL_ROUTER_VENDOR_ID}:`), `${PUBLIC_ROUTER_VENDOR_ID}:`);
}

export function toInternalModelId(modelId: string | null | undefined): string {
  if (!modelId) return "";
  return modelId.replace(new RegExp(`^${PUBLIC_ROUTER_VENDOR_ID}:`), `${INTERNAL_ROUTER_VENDOR_ID}:`);
}

import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthUser {
  id: number;
  name?: string;
}

interface RequestContext {
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithUser<T>(user: AuthUser | undefined, fn: () => T): T {
  return storage.run({ user }, fn);
}

export function getCurrentUser(): AuthUser | undefined {
  return storage.getStore()?.user;
}

export function getCurrentUserId(): number | undefined {
  return getCurrentUser()?.id;
}

export function normalizeAuthUser(value: unknown): AuthUser | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const id = Number(data.id);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  return {
    id,
    name: typeof data.name === "string" ? data.name : undefined,
  };
}

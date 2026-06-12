import type { AuthUser } from "@/utils/requestContext";

export type AgentMemoryType = "scriptAgent" | "productionAgent";

export interface AgentMemoryIsolationInput {
  agentType: AgentMemoryType;
  projectId: number;
  episodesId?: number | null;
  user?: AuthUser;
}

function normalizePositiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function buildLegacyAgentMemoryIsolationKey(agentType: AgentMemoryType, projectId: number, episodesId?: number | null): string {
  const normalizedProjectId = normalizePositiveId(projectId);
  if (!normalizedProjectId) throw new Error("缺少有效 projectId，无法生成 Agent 记忆隔离键");
  const normalizedEpisodesId = normalizePositiveId(episodesId);
  return `${normalizedProjectId}:${agentType}${normalizedEpisodesId ? `:${normalizedEpisodesId}` : ""}`;
}

export function buildAgentMemoryIsolationKey({ agentType, projectId, episodesId, user }: AgentMemoryIsolationInput): string {
  const normalizedProjectId = normalizePositiveId(projectId);
  if (!normalizedProjectId) throw new Error("缺少有效 projectId，无法生成 Agent 记忆隔离键");

  const normalizedEpisodesId = normalizePositiveId(episodesId);
  if (agentType === "productionAgent" && user?.id) {
    return [`u${user.id}`, `p${normalizedProjectId}`, agentType, normalizedEpisodesId ? `e${normalizedEpisodesId}` : null]
      .filter(Boolean)
      .join(":");
  }

  return buildLegacyAgentMemoryIsolationKey(agentType, normalizedProjectId, normalizedEpisodesId);
}

export function buildAgentMemoryIsolationKeys(input: AgentMemoryIsolationInput): string[] {
  const keys = [buildAgentMemoryIsolationKey(input), buildLegacyAgentMemoryIsolationKey(input.agentType, input.projectId, input.episodesId)];
  return Array.from(new Set(keys));
}

export function buildProjectMemoryIsolationLikePatterns(projectId: number): string[] {
  const normalizedProjectId = normalizePositiveId(projectId);
  if (!normalizedProjectId) throw new Error("缺少有效 projectId，无法生成项目记忆清理条件");
  return [`${normalizedProjectId}:%`, `%:p${normalizedProjectId}:%`];
}

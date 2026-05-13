export interface MemoryItem {
  id: string;
  agentId: string;
  title: string;
  body: string;
  pinned: boolean;
  shared: boolean;
  source: "markdown" | "yaml" | "sqlite-index";
  createdAt: string;
}

export interface ContextStatus {
  modelContextLimit: number;
  estimatedTokens: number;
  rollingSummary: string;
  pinnedFacts: string[];
  compressionRatio: number;
  lastCompressedAt?: string;
}

export function createMemoryItem(input: Omit<MemoryItem, "id" | "createdAt" | "source">, now = new Date().toISOString()): MemoryItem {
  return {
    ...input,
    id: `mem-${Date.parse(now) || 0}`,
    source: "markdown",
    createdAt: now,
  };
}

export function compressContext(status: ContextStatus, now = new Date().toISOString()): ContextStatus {
  const estimatedTokens = Math.max(800, Math.round(status.estimatedTokens * 0.42));
  return {
    ...status,
    estimatedTokens,
    rollingSummary: `${status.rollingSummary}\n已壓縮舊對話並保留釘選事實。`.trim(),
    compressionRatio: Number((estimatedTokens / status.estimatedTokens).toFixed(2)),
    lastCompressedAt: now,
  };
}

// The minimal query contract shared by the pure stores. Injecting this (instead of importing a
// pg Pool) keeps the stores unit-testable with a fake and dependency-free. The live pg-backed
// implementation lives in server/db/client.ts (the pg-backed `query`).
export type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>

import { call, type CallOptions, type CallResult } from "./execute.js";
import type { Operation, Site } from "./spec.js";

export type HealthStatus = "up" | "down" | "skipped";

export interface OperationHealth {
  site: string;
  operation: string;
  status: HealthStatus;
  checkedAt: string;
  latencyMs?: number;
  class?: CallResult["class"];
  tier?: CallResult["tier"];
  reason?: string;
}

export interface HealthSnapshot {
  checkedAt: string;
  ok: boolean;
  up: number;
  down: number;
  skipped: number;
  results: OperationHealth[];
}

type Invoke = typeof call;

function exampleArgs(op: Operation): { args: Record<string, unknown>; missing: string[] } {
  const args: Record<string, unknown> = {};
  for (const param of op.params) {
    if (param.example !== undefined) args[param.name] = param.example;
    else if (param.default !== undefined) args[param.name] = param.default;
  }
  const missing = op.params
    .filter((param) => param.required && args[param.name] === undefined)
    .map((param) => param.name);
  return { args, missing };
}

/** Check safe, saved read operations using the same validation and response classification as `call`. */
export async function checkSites(
  sites: Site[],
  options: CallOptions = {},
  invoke: Invoke = call,
): Promise<HealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const results: OperationHealth[] = [];

  for (const site of sites) {
    for (const op of site.operations) {
      if (!op.readOnly) {
        results.push({
          site: site.name,
          operation: op.name,
          status: "skipped",
          checkedAt,
          reason: "write operations are never executed by monitoring",
        });
        continue;
      }

      const { args, missing } = exampleArgs(op);
      if (missing.length) {
        results.push({
          site: site.name,
          operation: op.name,
          status: "skipped",
          checkedAt,
          reason: `no example or default for required params: ${missing.join(", ")}`,
        });
        continue;
      }

      const startedAt = Date.now();
      let result: CallResult;
      try {
        result = await invoke(site.name, op.name, args, options);
      } catch (error) {
        results.push({
          site: site.name,
          operation: op.name,
          status: "down",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          class: "error",
          reason: `health check failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      results.push({
        site: site.name,
        operation: op.name,
        status: result.ok ? "up" : "down",
        checkedAt: new Date().toISOString(),
        latencyMs: result.ms,
        class: result.class,
        ...(result.tier === undefined ? {} : { tier: result.tier }),
        ...(result.ok || !result.reason ? {} : { reason: result.reason }),
      });
    }
  }

  const up = results.filter((result) => result.status === "up").length;
  const down = results.filter((result) => result.status === "down").length;
  const skipped = results.length - up - down;
  return { checkedAt, ok: up > 0 && down === 0, up, down, skipped, results };
}

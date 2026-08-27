import { Load } from "../models/Load.js";
import { tenantFilter, type AccountScope } from "./scope.js";

/** Next load number for tenant: LD-1001, LD-1002, … */
export async function nextLoadNumber(scope: AccountScope): Promise<string> {
  const latest = await Load.findOne(tenantFilter(scope))
    .sort({ createdAt: -1 })
    .select("loadNumber")
    .lean();

  let next = 1001;
  if (latest?.loadNumber) {
    const match = String(latest.loadNumber).match(/(\d+)\s*$/);
    if (match) next = Number(match[1]) + 1;
  }
  return `LD-${next}`;
}

export function loadScopeFilter(scope: AccountScope): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...tenantFilter(scope) };
  if (!scope.isFullAccess) {
    filter.ownerUserId = scope.userId;
  }
  return filter;
}

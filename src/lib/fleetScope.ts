import type { AccountScope } from "./scope.js";
import { tenantFilter } from "./scope.js";

/**
 * Scope filter for Driver / Truck.
 * Full-access (Admin / Individual): entire tenant.
 * Dispatcher: only records assigned to them.
 */
export function fleetScopeFilter(scope: AccountScope): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...tenantFilter(scope) };
  if (!scope.isFullAccess) {
    filter.assignedUserId = scope.userId;
  }
  return filter;
}

/** Default assignedUserId when creating fleet records */
export function defaultAssignedUserId(scope: AccountScope): string | null {
  if (scope.isFullAccess) return null;
  return scope.userId;
}

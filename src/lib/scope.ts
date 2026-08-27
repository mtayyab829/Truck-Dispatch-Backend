import type { Request } from "express";
import type { Types } from "mongoose";
import type { AccountType, UserRole } from "../models/enums.js";

/**
 * Session payload attached after JWT verification.
 * accountId is ALWAYS taken from the session — never from the client body.
 */
export interface AuthSession {
  userId: string;
  accountId: string;
  role: UserRole;
  accountType: AccountType;
  email: string;
  name: string;
}

export interface AccountScope {
  accountId: Types.ObjectId | string;
  userId: string;
  role: UserRole;
  accountType: AccountType;
  /** True when the user may see all tenant data (Admin or Individual Owner) */
  isFullAccess: boolean;
}

/**
 * Central tenant scoping helper.
 * Every data query MUST start from this — never trust client-supplied accountId.
 */
export function getAccountScope(session: AuthSession): AccountScope {
  const isFullAccess =
    session.accountType === "INDIVIDUAL" || session.role === "ADMIN";

  return {
    accountId: session.accountId,
    userId: session.userId,
    role: session.role,
    accountType: session.accountType,
    isFullAccess,
  };
}

/** Base Mongo filter: always constrain by tenant */
export function tenantFilter(scope: AccountScope): { accountId: string } {
  return { accountId: String(scope.accountId) };
}

/**
 * For company dispatchers, further constrain to their assignment scope.
 * Full-access users get only the tenant filter.
 * (UserAssignment filtering is wired in M6; M0 returns tenant-only.)
 */
export function scopedResourceFilter(
  scope: AccountScope,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...tenantFilter(scope),
    ...extra,
  };
}

export function requireAdmin(scope: AccountScope): void {
  if (!scope.isFullAccess || scope.role !== "ADMIN") {
    if (scope.accountType === "INDIVIDUAL") return; // Individual owner is full access
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
}

export function getSessionFromRequest(req: Request): AuthSession {
  if (!req.session) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return req.session;
}

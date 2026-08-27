import { ActivityLog } from "../models/ActivityLog.js";

export async function logActivity(input: {
  accountId: string;
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  await ActivityLog.create({
    accountId: input.accountId,
    userId: input.userId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    details: input.details ?? null,
  });
}

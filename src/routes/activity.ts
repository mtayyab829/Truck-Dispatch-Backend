import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { User } from "../models/User.js";

export const activityRouter = Router();
activityRouter.use(requireAuth);

activityRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...tenantFilter(scope) };
    if (!scope.isFullAccess) {
      filter.userId = scope.userId;
    }
    if (req.query.entityType) filter.entityType = String(req.query.entityType);

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean).map(String))];
    const users = await User.find({ _id: { $in: userIds } }).select("name email").lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      activities: logs.map((l) => ({
        id: String(l._id),
        accountId: String(l.accountId),
        userId: l.userId ? String(l.userId) : null,
        userName: l.userId ? userMap.get(String(l.userId))?.name ?? null : null,
        entityType: l.entityType,
        entityId: l.entityId,
        action: l.action,
        details: l.details ?? null,
        createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

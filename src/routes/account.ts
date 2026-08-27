import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { Account } from "../models/Account.js";
import { User } from "../models/User.js";
import { ActivityLog } from "../models/ActivityLog.js";

/**
 * M0 isolation probe endpoints.
 * All queries are forced through getAccountScope — client cannot pass accountId.
 */
export const accountRouter = Router();

accountRouter.use(requireAuth);

accountRouter.get("/summary", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter = tenantFilter(scope);

    const [account, userCount, activityCount] = await Promise.all([
      Account.findById(scope.accountId).lean(),
      User.countDocuments(filter),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({
      account: account
        ? {
            id: String(account._id),
            name: account.name,
            type: account.type,
            currency: account.currency,
          }
        : null,
      stats: {
        users: userCount,
        activityEvents: activityCount,
      },
      scope: {
        accountId: String(scope.accountId),
        userId: scope.userId,
        role: scope.role,
        isFullAccess: scope.isFullAccess,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Lists users in THIS account only — proves tenant isolation */
accountRouter.get("/users", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const users = await User.find(tenantFilter(scope))
      .select("_id name email role isActive createdAt")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

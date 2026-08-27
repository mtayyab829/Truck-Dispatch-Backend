import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { Account } from "../models/Account.js";
import { User } from "../models/User.js";
import { UserRole } from "../models/enums.js";
import { registerSchema, loginSchema } from "../validators/auth.js";
import {
  clearAuthCookie,
  requireAuth,
  setAuthCookie,
  signSessionToken,
} from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { logActivity } from "../lib/activity.js";
import { getAccountScope } from "../lib/scope.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);

    const existing = await User.findOne({ email: input.email }).lean();
    if (existing) {
      throw new AppError("Email is already registered", 409);
    }

    const account = await Account.create({
      type: input.accountType,
      name: input.accountName,
      currency: "USD",
      defaultCommissionType: "PERCENTAGE",
      defaultCommissionValue: 5,
      settings: {
        moneyFlowModel: "DRIVER_PAYS_COMMISSION",
        invoicePrefix: "INV-",
        loadPrefix: "LD-",
      },
    });

    const passwordHash = await bcrypt.hash(input.password, 12);

    // Individual owner and Company first user are both ADMIN over their account
    const user = await User.create({
      accountId: account._id,
      role: UserRole.ADMIN,
      name: input.name,
      email: input.email,
      passwordHash,
      isActive: true,
    });

    await logActivity({
      accountId: String(account._id),
      userId: String(user._id),
      entityType: "Account",
      entityId: String(account._id),
      action: "ACCOUNT_REGISTERED",
      details: { accountType: account.type, email: user.email },
    });

    const session = {
      userId: String(user._id),
      accountId: String(account._id),
      role: user.role,
      accountType: account.type,
      email: user.email,
      name: user.name,
    };

    const token = signSessionToken(session);
    setAuthCookie(res, token);

    res.status(201).json({
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        role: session.role,
        accountType: session.accountType,
        accountId: session.accountId,
        accountName: account.name,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);

    const user = await User.findOne({ email: input.email });
    if (!user || !user.isActive) {
      throw new AppError("Invalid email or password", 401);
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new AppError("Invalid email or password", 401);
    }

    const account = await Account.findById(user.accountId);
    if (!account) {
      throw new AppError("Account not found", 401);
    }

    const session = {
      userId: String(user._id),
      accountId: String(account._id),
      role: user.role,
      accountType: account.type,
      email: user.email,
      name: user.name,
    };

    const token = signSessionToken(session);
    setAuthCookie(res, token);

    await logActivity({
      accountId: session.accountId,
      userId: session.userId,
      entityType: "User",
      entityId: session.userId,
      action: "USER_LOGIN",
    });

    res.json({
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        role: session.role,
        accountType: session.accountType,
        accountId: session.accountId,
        accountName: account.name,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const session = req.session!;
    const scope = getAccountScope(session);
    const account = await Account.findById(scope.accountId).lean();
    if (!account) {
      throw new AppError("Account not found", 404);
    }

    res.json({
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        role: session.role,
        accountType: session.accountType,
        accountId: session.accountId,
        accountName: account.name,
        currency: account.currency,
        isFullAccess: scope.isFullAccess,
      },
    });
  } catch (err) {
    next(err);
  }
});

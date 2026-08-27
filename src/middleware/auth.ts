import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthSession } from "../lib/scope.js";
import { User } from "../models/User.js";
import { Account } from "../models/Account.js";

declare global {
  namespace Express {
    interface Request {
      session?: AuthSession;
    }
  }
}

const COOKIE_NAME = "td_session";

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}

export function signSessionToken(payload: AuthSession): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token =
      req.cookies?.[COOKIE_NAME] ??
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined);

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthSession;

    const user = await User.findById(decoded.userId).lean();
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const account = await Account.findById(user.accountId).lean();
    if (!account) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Re-bind from DB so role/account cannot be spoofed via a stale token
    req.session = {
      userId: String(user._id),
      accountId: String(user.accountId),
      role: user.role,
      accountType: account.type,
      email: user.email,
      name: user.name,
    };

    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

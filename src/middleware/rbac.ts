import type { Request, Response, NextFunction } from "express";
import { getAccountScope } from "../lib/scope.js";
import { AppError } from "./errorHandler.js";

/** Company Admin only (Individual owners also allowed — they are ADMIN) */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      next();
      return;
    }
    if (scope.role !== "ADMIN") {
      throw new AppError("Admin access required", 403);
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Block company dispatchers from settings */
export function requireSettingsAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "COMPANY" && scope.role !== "ADMIN") {
      throw new AppError("Settings access requires Admin", 403);
    }
    next();
  } catch (err) {
    next(err);
  }
}

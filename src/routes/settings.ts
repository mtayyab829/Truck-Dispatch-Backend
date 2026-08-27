import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireSettingsAccess } from "../middleware/rbac.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope } from "../lib/scope.js";
import { logActivity } from "../lib/activity.js";
import { Account } from "../models/Account.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { Transaction } from "../models/Transaction.js";
import { Invoice } from "../models/Invoice.js";
import { Expense } from "../models/Expense.js";
import { CommissionType } from "../models/enums.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
settingsRouter.use(requireSettingsAccess);

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  defaultCommissionType: z
    .enum([CommissionType.PERCENTAGE, CommissionType.FIXED])
    .optional(),
  defaultCommissionValue: z.number().optional(),
  settings: z
    .object({
      moneyFlowModel: z.string().optional(),
      invoicePrefix: z.string().optional(),
      loadPrefix: z.string().optional(),
      notifyOverdueInvoices: z.boolean().optional(),
      notifyDocExpiry: z.boolean().optional(),
      notifyMissingPod: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

settingsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const account = await Account.findById(scope.accountId).lean();
    if (!account) throw new AppError("Account not found", 404);

    res.json({
      account: {
        id: String(account._id),
        type: account.type,
        name: account.name,
        currency: account.currency,
        defaultCommissionType: account.defaultCommissionType,
        defaultCommissionValue: account.defaultCommissionValue,
        settings: account.settings ?? {},
        createdAt: account.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = updateSchema.parse(req.body);
    const account = await Account.findById(scope.accountId);
    if (!account) throw new AppError("Account not found", 404);

    if (input.name !== undefined) account.name = input.name;
    if (input.currency !== undefined) account.currency = input.currency;
    if (input.defaultCommissionType !== undefined) {
      account.defaultCommissionType = input.defaultCommissionType;
    }
    if (input.defaultCommissionValue !== undefined) {
      account.defaultCommissionValue = input.defaultCommissionValue;
    }
    if (input.settings) {
      const prev =
        account.settings && typeof account.settings === "object"
          ? (account.settings as Record<string, unknown>)
          : {};
      account.settings = { ...prev, ...input.settings };
      account.markModified("settings");
    }
    await account.save();

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Account",
      entityId: String(account._id),
      action: "SETTINGS_UPDATED",
      details: input,
    });

    res.json({
      account: {
        id: String(account._id),
        type: account.type,
        name: account.name,
        currency: account.currency,
        defaultCommissionType: account.defaultCommissionType,
        defaultCommissionValue: account.defaultCommissionValue,
        settings: account.settings ?? {},
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Full tenant data export (JSON backup) */
settingsRouter.get("/export", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const accountId = scope.accountId;
    const [account, drivers, trucks, loads, transactions, invoices, expenses] =
      await Promise.all([
        Account.findById(accountId).lean(),
        Driver.find({ accountId }).lean(),
        Truck.find({ accountId }).lean(),
        Load.find({ accountId }).lean(),
        Transaction.find({ accountId }).lean(),
        Invoice.find({ accountId }).lean(),
        Expense.find({ accountId }).lean(),
      ]);

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="truckops-backup-${String(accountId)}.json"`
    );
    res.json({
      exportedAt: new Date().toISOString(),
      account,
      drivers,
      trucks,
      loads,
      transactions,
      invoices,
      expenses,
    });
  } catch (err) {
    next(err);
  }
});

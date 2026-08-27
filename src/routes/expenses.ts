import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { roundMoney } from "../lib/commission.js";
import { logActivity } from "../lib/activity.js";
import {
  serializeDriver,
  serializeExpense,
  serializeLoad,
  serializeTruck,
} from "../lib/serializers.js";
import { Expense } from "../models/Expense.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { createExpenseSchema, updateExpenseSchema } from "../validators/finance.js";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

function expenseFilter(scope: ReturnType<typeof getAccountScope>) {
  const filter: Record<string, unknown> = { ...tenantFilter(scope) };
  if (!scope.isFullAccess) {
    filter.userId = scope.userId;
  }
  return filter;
}

expensesRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter = expenseFilter(scope);
    if (req.query.category) filter.category = String(req.query.category);

    const expenses = await Expense.find(filter).sort({ date: -1 }).lean();

    const driverIds = [...new Set(expenses.map((e) => e.driverId).filter(Boolean).map(String))];
    const truckIds = [...new Set(expenses.map((e) => e.truckId).filter(Boolean).map(String))];
    const loadIds = [...new Set(expenses.map((e) => e.loadId).filter(Boolean).map(String))];

    const [drivers, trucks, loads] = await Promise.all([
      Driver.find({ _id: { $in: driverIds }, ...tenantFilter(scope) }).lean(),
      Truck.find({ _id: { $in: truckIds }, ...tenantFilter(scope) }).lean(),
      Load.find({ _id: { $in: loadIds }, ...tenantFilter(scope) }).lean(),
    ]);
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));
    const truckMap = new Map(trucks.map((t) => [String(t._id), serializeTruck(t)]));
    const loadMap = new Map(loads.map((l) => [String(l._id), serializeLoad(l)]));

    const total = roundMoney(expenses.reduce((s, e) => s + e.amount, 0));

    res.json({
      expenses: expenses.map((e) => ({
        ...serializeExpense(e),
        driver: e.driverId ? driverMap.get(String(e.driverId)) ?? null : null,
        truck: e.truckId ? truckMap.get(String(e.truckId)) ?? null : null,
        load: e.loadId ? loadMap.get(String(e.loadId)) ?? null : null,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

expensesRouter.post("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createExpenseSchema.parse(req.body);
    if (input.amount <= 0) throw new AppError("Amount must be positive", 400);

    if (input.driverId) {
      const d = await Driver.findOne({
        ...fleetScopeFilter(scope),
        _id: input.driverId,
      }).lean();
      if (!d) throw new AppError("Driver not found", 404);
    }
    if (input.truckId) {
      const t = await Truck.findOne({
        ...fleetScopeFilter(scope),
        _id: input.truckId,
      }).lean();
      if (!t) throw new AppError("Truck not found", 404);
    }
    if (input.loadId) {
      const l = await Load.findOne({
        ...loadScopeFilter(scope),
        _id: input.loadId,
      }).lean();
      if (!l) throw new AppError("Load not found", 404);
    }

    const expense = await Expense.create({
      accountId: scope.accountId,
      category: input.category,
      amount: roundMoney(input.amount),
      date: input.date,
      loadId: input.loadId,
      driverId: input.driverId,
      truckId: input.truckId,
      userId: scope.userId,
      notes: input.notes,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Expense",
      entityId: String(expense._id),
      action: "EXPENSE_CREATED",
      details: { category: input.category, amount: input.amount },
    });

    res.status(201).json({ expense: serializeExpense(expense.toObject()) });
  } catch (err) {
    next(err);
  }
});

expensesRouter.patch("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = updateExpenseSchema.parse(req.body);
    const patch: Record<string, unknown> = { ...input };
    if (input.amount !== undefined) {
      if (input.amount <= 0) throw new AppError("Amount must be positive", 400);
      patch.amount = roundMoney(input.amount);
    }

    const expense = await Expense.findOneAndUpdate(
      { ...expenseFilter(scope), _id: req.params.id },
      { $set: patch },
      { new: true }
    ).lean();

    if (!expense) throw new AppError("Expense not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Expense",
      entityId: String(expense._id),
      action: "EXPENSE_UPDATED",
      details: patch,
    });

    res.json({ expense: serializeExpense(expense) });
  } catch (err) {
    next(err);
  }
});

expensesRouter.delete("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const expense = await Expense.findOneAndDelete({
      ...expenseFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!expense) throw new AppError("Expense not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Expense",
      entityId: String(expense._id),
      action: "EXPENSE_DELETED",
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

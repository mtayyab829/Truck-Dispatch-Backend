import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { isCommissionEarned, roundMoney } from "../lib/commission.js";
import { refreshRateSettled } from "../lib/freight.js";
import { logActivity } from "../lib/activity.js";
import {
  notifyCompanyAdmin,
  buildPaymentRecordedNotify,
} from "../lib/adminNotify.js";
import {
  serializeDriver,
  serializeLoad,
  serializeTransaction,
} from "../lib/serializers.js";
import { Transaction } from "../models/Transaction.js";
import { Driver } from "../models/Driver.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { Invoice } from "../models/Invoice.js";
import { InvoicePayment } from "../models/InvoicePayment.js";
import { Direction, TransactionType } from "../models/enums.js";
import { createPaymentSchema } from "../validators/finance.js";
import { deriveInvoiceStatus } from "../lib/invoice.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

function defaultDirection(type: string): "IN" | "OUT" {
  if (type === TransactionType.DRIVER_PAYMENT) return Direction.OUT;
  if (type === TransactionType.COMMISSION_RECEIVED) return Direction.IN;
  if (type === TransactionType.FREIGHT_RECEIVED) return Direction.IN;
  if (type === TransactionType.ADVANCE) return Direction.OUT;
  return Direction.IN;
}

paymentsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...tenantFilter(scope) };
    if (!scope.isFullAccess) {
      filter.createdByUserId = scope.userId;
    }
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.driverId) filter.driverId = String(req.query.driverId);
    if (req.query.loadId) filter.loadId = String(req.query.loadId);

    const txs = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).lean();

    const loadIds = [...new Set(txs.map((t) => t.loadId).filter(Boolean).map(String))];
    const loads = await Load.find({
      _id: { $in: loadIds },
      ...tenantFilter(scope),
    }).lean();
    const loadMap = new Map(loads.map((l) => [String(l._id), serializeLoad(l)]));

    const assignments = await LoadAssignment.find({
      loadId: { $in: loadIds },
      releasedAt: null,
    }).lean();
    const assignDriverByLoad = new Map(
      assignments.map((a) => [String(a.loadId), String(a.driverId)])
    );

    const driverIds = [
      ...new Set(
        [
          ...txs.map((t) => (t.driverId ? String(t.driverId) : null)),
          ...assignments.map((a) => String(a.driverId)),
        ].filter(Boolean) as string[]
      ),
    ];
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));

    res.json({
      payments: txs.map((t) => {
        const loadId = t.loadId ? String(t.loadId) : null;
        const driverId =
          (t.driverId ? String(t.driverId) : null) ??
          (loadId ? assignDriverByLoad.get(loadId) ?? null : null);
        return {
          ...serializeTransaction(t),
          driver: driverId ? driverMap.get(driverId) ?? null : null,
          load: loadId ? loadMap.get(loadId) ?? null : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.get("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const filter: Record<string, unknown> = {
      ...tenantFilter(scope),
      _id: req.params.id,
    };
    if (!scope.isFullAccess) filter.createdByUserId = scope.userId;

    const tx = await Transaction.findOne(filter).lean();
    if (!tx) throw new AppError("Payment not found", 404);

    res.json({ payment: serializeTransaction(tx) });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createPaymentSchema.parse(req.body);

    if (input.amount <= 0) throw new AppError("Amount must be positive", 400);

    let driverId = input.driverId;
    let loadId = input.loadId;
    let linkedLoad: { _id: mongoose.Types.ObjectId; loadNumber: string } | null = null;

    if (loadId) {
      if (!mongoose.Types.ObjectId.isValid(loadId)) {
        throw new AppError("Invalid loadId", 400);
      }
      const load = await Load.findOne({
        ...loadScopeFilter(scope),
        _id: loadId,
      }).lean();
      if (!load) throw new AppError("Load not found", 404);
      linkedLoad = { _id: load._id, loadNumber: load.loadNumber };

      if (
        input.type === TransactionType.COMMISSION_RECEIVED &&
        !isCommissionEarned(load.loadStatus)
      ) {
        throw new AppError("Commission is not earned until load is delivered", 400);
      }

      if (input.type === TransactionType.FREIGHT_RECEIVED) {
        if (!loadId) {
          throw new AppError("Freight payment requires a load", 400);
        }
        const { FREIGHT_PAYMENT_STATUSES } = await import("../lib/loadStatus.js");
        if (!FREIGHT_PAYMENT_STATUSES.has(load.loadStatus)) {
          throw new AppError(
            "Freight payment can only be recorded at the POD received / payment step",
            400
          );
        }
      }

      // Attach assigned driver when not provided
      if (!driverId) {
        const assignment = await LoadAssignment.findOne({
          loadId: load._id,
          releasedAt: null,
        }).lean();
        if (assignment) driverId = String(assignment.driverId);
      }
    }

    if (driverId) {
      if (!mongoose.Types.ObjectId.isValid(driverId)) {
        throw new AppError("Invalid driverId", 400);
      }
      const driver = await Driver.findOne({
        ...fleetScopeFilter(scope),
        _id: driverId,
      }).lean();
      if (!driver) throw new AppError("Driver not found", 404);
    }

    const direction: "IN" | "OUT" = input.direction ?? defaultDirection(input.type);

    const tx = await Transaction.create({
      accountId: scope.accountId,
      loadId: loadId ?? null,
      driverId: driverId ?? null,
      createdByUserId: scope.userId,
      type: input.type,
      direction,
      amount: roundMoney(input.amount),
      date: input.date,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
    });

    if (
      input.type === TransactionType.COMMISSION_RECEIVED &&
      loadId
    ) {
      const load = await Load.findById(loadId).lean();
      if (load) {
        const paid = await Transaction.aggregate([
          {
            $match: {
              accountId: new mongoose.Types.ObjectId(String(scope.accountId)),
              loadId: load._id,
              type: TransactionType.COMMISSION_RECEIVED,
              direction: Direction.IN,
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const total = roundMoney((paid[0]?.total as number) ?? 0);
        if (total + 0.001 >= load.commissionAmount) {
          await Load.updateOne({ _id: load._id }, { $set: { commissionSettled: true } });
        }
      }
    }

    if (input.type === TransactionType.FREIGHT_RECEIVED && loadId) {
      const load = await Load.findById(loadId).lean();
      if (load) {
        await refreshRateSettled(scope.accountId, load);
      }
    }

    // Optional link to invoice
    if (input.invoiceId) {
      if (!mongoose.Types.ObjectId.isValid(input.invoiceId)) {
        throw new AppError("Invalid invoiceId", 400);
      }
      const invoice = await Invoice.findOne({
        ...tenantFilter(scope),
        _id: input.invoiceId,
      }).lean();
      if (!invoice) throw new AppError("Invoice not found", 404);

      await InvoicePayment.create({
        invoiceId: invoice._id,
        transactionId: tx._id,
      });

      const links = await InvoicePayment.find({ invoiceId: invoice._id }).lean();
      const txIds = links.map((l) => l.transactionId);
      const related = await Transaction.find({ _id: { $in: txIds } }).lean();
      const paidTotal = roundMoney(related.reduce((s, t) => s + t.amount, 0));
      const nextStatus = deriveInvoiceStatus({
        status: invoice.status,
        dueDate: invoice.dueDate,
        amount: invoice.amount,
        paidTotal,
      });
      await Invoice.updateOne({ _id: invoice._id }, { $set: { status: nextStatus } });
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Transaction",
      entityId: String(tx._id),
      action: "PAYMENT_RECORDED",
      details: {
        type: input.type,
        amount: input.amount,
        loadId,
        driverId,
        invoiceId: input.invoiceId,
      },
    });

    if (
      linkedLoad &&
      (input.type === TransactionType.FREIGHT_RECEIVED ||
        input.type === TransactionType.COMMISSION_RECEIVED)
    ) {
      await notifyCompanyAdmin(
        scope,
        { userId: scope.userId, name: req.session!.name },
        buildPaymentRecordedNotify({
          actorName: req.session!.name,
          loadNumber: linkedLoad.loadNumber,
          loadId: String(linkedLoad._id),
          paymentKind:
            input.type === TransactionType.FREIGHT_RECEIVED
              ? "freight"
              : "commission",
          amount: input.amount,
          method: input.method,
        })
      );
    }

    res.status(201).json({ payment: serializeTransaction(tx.toObject()) });
  } catch (err) {
    next(err);
  }
});

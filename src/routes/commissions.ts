import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { isCommissionEarned, roundMoney } from "../lib/commission.js";
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
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { Driver } from "../models/Driver.js";
import { Transaction } from "../models/Transaction.js";
import {
  Direction,
  LoadStatus,
  TransactionType,
} from "../models/enums.js";
import { recordCommissionPaymentSchema } from "../validators/loads.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";

export const commissionsRouter = Router();
commissionsRouter.use(requireAuth);

type CommissionRowStatus = "Pending" | "Due" | "Paid" | "Cancelled";

function rowStatus(
  loadStatus: string,
  commissionAmount: number,
  received: number
): CommissionRowStatus {
  if (loadStatus === LoadStatus.CANCELLED) return "Cancelled";
  if (!isCommissionEarned(loadStatus)) return "Pending";
  if (received + 0.001 >= commissionAmount) return "Paid";
  return "Due";
}

async function receivedByLoad(
  accountId: string,
  loadIds: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  if (loadIds.length === 0) return new Map();
  const rows = await Transaction.aggregate([
    {
      $match: {
        accountId: new mongoose.Types.ObjectId(accountId),
        loadId: { $in: loadIds },
        type: TransactionType.COMMISSION_RECEIVED,
        direction: Direction.IN,
      },
    },
    { $group: { _id: "$loadId", total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), roundMoney(r.total as number)]));
}

commissionsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...loadScopeFilter(scope) };
    if (req.query.driverId) {
      const assigns = await LoadAssignment.find({
        driverId: String(req.query.driverId),
        releasedAt: null,
      })
        .select("loadId")
        .lean();
      filter._id = { $in: assigns.map((a) => a.loadId) };
    }

    const loads = await Load.find(filter).sort({ createdAt: -1 }).lean();
    const loadIds = loads.map((l) => l._id);
    const receivedMap = await receivedByLoad(String(scope.accountId), loadIds);

    const assigns = await LoadAssignment.find({
      loadId: { $in: loadIds },
      releasedAt: null,
    }).lean();
    const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));
    const driverIds = [...new Set(assigns.map((a) => String(a.driverId)))];
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));

    const statusFilter = req.query.status ? String(req.query.status) : null;

    const commissions = loads
      .map((l) => {
        const received = receivedMap.get(String(l._id)) ?? 0;
        const status = rowStatus(l.loadStatus, l.commissionAmount, received);
        const a = assignByLoad.get(String(l._id));
        return {
          loadId: String(l._id),
          loadNumber: l.loadNumber,
          loadStatus: l.loadStatus,
          rate: l.rate,
          commissionType: l.commissionType,
          commissionValue: l.commissionValue,
          commissionAmount: l.commissionAmount,
          commissionReceived: received,
          outstanding: roundMoney(Math.max(0, l.commissionAmount - received)),
          status,
          earned: isCommissionEarned(l.loadStatus),
          driver: a ? driverMap.get(String(a.driverId)) ?? null : null,
          pickupCity: l.pickupCity,
          deliveryCity: l.deliveryCity,
          deliveryDateTime: l.deliveryDateTime
            ? new Date(l.deliveryDateTime).toISOString()
            : null,
        };
      })
      .filter((c) => (statusFilter ? c.status === statusFilter : true));

    res.json({ commissions });
  } catch (err) {
    next(err);
  }
});

/** Outstanding commission by driver with load drill-down */
commissionsRouter.get("/by-driver", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const earnedLoads = await Load.find({
      ...loadScopeFilter(scope),
      loadStatus: {
        $in: [
          LoadStatus.DELIVERED,
          LoadStatus.POD_RECEIVED,
          LoadStatus.PAYMENT_FOLLOW_UP,
          LoadStatus.PAYMENT_COMPLETED,
        ],
      },
    }).lean();

    const loadIds = earnedLoads.map((l) => l._id);
    const receivedMap = await receivedByLoad(String(scope.accountId), loadIds);

    const assigns = await LoadAssignment.find({
      loadId: { $in: loadIds },
      releasedAt: null,
    }).lean();
    const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));

    const byDriver = new Map<
      string,
      {
        driverId: string;
        earned: number;
        received: number;
        outstanding: number;
        loads: Array<{
          loadId: string;
          loadNumber: string;
          commissionAmount: number;
          commissionReceived: number;
          outstanding: number;
          loadStatus: string;
          route: string;
        }>;
      }
    >();

    for (const l of earnedLoads) {
      const a = assignByLoad.get(String(l._id));
      if (!a) continue;
      const driverId = String(a.driverId);
      const received = receivedMap.get(String(l._id)) ?? 0;
      const outstanding = roundMoney(Math.max(0, l.commissionAmount - received));
      if (!byDriver.has(driverId)) {
        byDriver.set(driverId, {
          driverId,
          earned: 0,
          received: 0,
          outstanding: 0,
          loads: [],
        });
      }
      const bucket = byDriver.get(driverId)!;
      bucket.earned = roundMoney(bucket.earned + l.commissionAmount);
      bucket.received = roundMoney(bucket.received + received);
      bucket.outstanding = roundMoney(bucket.outstanding + outstanding);
      bucket.loads.push({
        loadId: String(l._id),
        loadNumber: l.loadNumber,
        commissionAmount: l.commissionAmount,
        commissionReceived: received,
        outstanding,
        loadStatus: l.loadStatus,
        route: `${l.pickupCity} → ${l.deliveryCity}`,
      });
    }

    const driverIds = [...byDriver.keys()];
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      ...fleetScopeFilter(scope),
    }).lean();
    // Admin sees all tenant drivers in buckets even if filter differs
    const allDrivers = await Driver.find({
      _id: { $in: driverIds },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(
      (drivers.length ? drivers : allDrivers).map((d) => [
        String(d._id),
        serializeDriver(d),
      ])
    );
    // Prefer tenant map for names
    for (const d of allDrivers) driverMap.set(String(d._id), serializeDriver(d));

    const items = [...byDriver.values()]
      .map((b) => ({
        driver: driverMap.get(b.driverId) ?? null,
        driverId: b.driverId,
        earned: b.earned,
        received: b.received,
        outstanding: b.outstanding,
        loads: b.loads,
      }))
      .filter((b) => b.outstanding > 0 || req.query.includeZero === "true")
      .sort((a, b) => b.outstanding - a.outstanding);

    res.json({ drivers: items });
  } catch (err) {
    next(err);
  }
});

/** Record commission payment against a load (partial OK) */
commissionsRouter.post("/payments", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = recordCommissionPaymentSchema.parse(req.body);

    if (!mongoose.Types.ObjectId.isValid(input.loadId)) {
      throw new AppError("Invalid loadId", 400);
    }

    const load = await Load.findOne({
      ...loadScopeFilter(scope),
      _id: input.loadId,
    }).lean();
    if (!load) throw new AppError("Load not found", 404);
    if (!isCommissionEarned(load.loadStatus)) {
      throw new AppError("Commission is not earned until load is delivered", 400);
    }
    if (input.amount <= 0) throw new AppError("Amount must be positive", 400);

    const assignment = await LoadAssignment.findOne({
      loadId: load._id,
      releasedAt: null,
    }).lean();
    if (!assignment) throw new AppError("Load has no active driver assignment", 400);

    const receivedMap = await receivedByLoad(String(scope.accountId), [load._id]);
    const already = receivedMap.get(String(load._id)) ?? 0;

    const tx = await Transaction.create({
      accountId: scope.accountId,
      loadId: load._id,
      driverId: assignment.driverId,
      createdByUserId: scope.userId,
      type: TransactionType.COMMISSION_RECEIVED,
      direction: Direction.IN,
      amount: roundMoney(input.amount),
      date: input.date,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
    });

    const totalReceived = roundMoney(already + input.amount);
    if (totalReceived + 0.001 >= load.commissionAmount) {
      await Load.updateOne({ _id: load._id }, { $set: { commissionSettled: true } });
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Transaction",
      entityId: String(tx._id),
      action: "COMMISSION_RECEIVED",
      details: {
        loadId: String(load._id),
        amount: input.amount,
        totalReceived,
      },
    });

    await notifyCompanyAdmin(
      scope,
      { userId: scope.userId, name: req.session!.name },
      buildPaymentRecordedNotify({
        actorName: req.session!.name,
        loadNumber: load.loadNumber,
        loadId: String(load._id),
        paymentKind: "commission",
        amount: input.amount,
        method: input.method,
      })
    );

    res.status(201).json({
      transaction: serializeTransaction(tx.toObject()),
      load: serializeLoad(
        (await Load.findById(load._id).lean()) as Record<string, unknown>
      ),
      commissionReceived: totalReceived,
      outstanding: roundMoney(Math.max(0, load.commissionAmount - totalReceived)),
    });
  } catch (err) {
    next(err);
  }
});

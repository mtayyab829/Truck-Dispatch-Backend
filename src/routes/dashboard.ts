import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { isCommissionEarned, roundMoney } from "../lib/commission.js";
import {
  serializeDriver,
  serializeLoad,
} from "../lib/serializers.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { Transaction } from "../models/Transaction.js";
import { Invoice } from "../models/Invoice.js";
import { InvoicePayment } from "../models/InvoicePayment.js";
import { Expense } from "../models/Expense.js";
import { DocumentModel } from "../models/Document.js";
import { User } from "../models/User.js";
import { Direction, DocEntityType, DocType, LoadStatus, TransactionType } from "../models/enums.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filterUserId = req.query.userId ? String(req.query.userId) : null;

    // Admin can filter company metrics by dispatcher
    let loadFilter = loadScopeFilter(scope);
    let fleetFilter = fleetScopeFilter(scope);
    let expenseFilter: Record<string, unknown> = { ...tenantFilter(scope) };

    if (scope.isFullAccess && filterUserId && mongoose.Types.ObjectId.isValid(filterUserId)) {
      loadFilter = { ...tenantFilter(scope), ownerUserId: filterUserId };
      fleetFilter = { ...tenantFilter(scope), assignedUserId: filterUserId };
      expenseFilter = { ...tenantFilter(scope), userId: filterUserId };
    } else if (!scope.isFullAccess) {
      expenseFilter.userId = scope.userId;
    }

    const monthStart = startOfMonth();

    const [
      driversCount,
      trucksCount,
      usersCount,
      allLoads,
      monthLoads,
      expenses,
      invoices,
      docs,
    ] = await Promise.all([
      Driver.countDocuments({ ...fleetFilter, isActive: true }),
      Truck.countDocuments({ ...fleetFilter, isActive: true }),
      User.countDocuments(tenantFilter(scope)),
      Load.find(loadFilter).sort({ createdAt: -1 }).lean(),
      Load.find({
        ...loadFilter,
        createdAt: { $gte: monthStart },
      }).lean(),
      Expense.find(expenseFilter).lean(),
      Invoice.find(
        scope.isFullAccess
          ? tenantFilter(scope)
          : { ...tenantFilter(scope), createdByUserId: scope.userId }
      ).lean(),
      DocumentModel.find(tenantFilter(scope)).lean(),
    ]);

    const activeStatuses = new Set([
      LoadStatus.ASSIGNED,
      LoadStatus.AT_PICKUP,
      LoadStatus.PICKED_UP,
      LoadStatus.IN_TRANSIT,
      LoadStatus.AT_DELIVERY,
    ]);
    const completedStatuses = new Set([
      LoadStatus.DELIVERED,
      LoadStatus.POD_RECEIVED,
      LoadStatus.PAYMENT_FOLLOW_UP,
      LoadStatus.PAYMENT_COMPLETED,
    ]);

    const monthCompleted = monthLoads.filter((l) => completedStatuses.has(l.loadStatus as never));
    const grossLoadValue = roundMoney(monthLoads.reduce((s, l) => s + l.rate, 0));
    const commissionEarned = roundMoney(
      monthLoads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce((s, l) => s + l.commissionAmount, 0)
    );

    const earnedLoadIds = allLoads
      .filter((l) => isCommissionEarned(l.loadStatus))
      .map((l) => l._id);

    const receivedAgg = await Transaction.aggregate([
      {
        $match: {
          accountId: new mongoose.Types.ObjectId(String(scope.accountId)),
          type: TransactionType.COMMISSION_RECEIVED,
          direction: Direction.IN,
          loadId: { $in: earnedLoadIds },
          ...(scope.isFullAccess && !filterUserId
            ? {}
            : { createdByUserId: new mongoose.Types.ObjectId(filterUserId ?? scope.userId) }),
        },
      },
      { $group: { _id: "$loadId", total: { $sum: "$amount" } } },
    ]);
    // For admin without filter, don't constrain createdByUserId
    const receivedAll = await Transaction.aggregate([
      {
        $match: {
          accountId: new mongoose.Types.ObjectId(String(scope.accountId)),
          type: TransactionType.COMMISSION_RECEIVED,
          direction: Direction.IN,
          loadId: { $in: earnedLoadIds },
        },
      },
      { $group: { _id: "$loadId", total: { $sum: "$amount" } } },
    ]);
    const receivedMap = new Map(
      (scope.isFullAccess && !filterUserId ? receivedAll : receivedAgg).map((r) => [
        String(r._id),
        roundMoney(r.total as number),
      ])
    );

    let commissionReceived = 0;
    let commissionOutstanding = 0;
    for (const l of allLoads) {
      if (!isCommissionEarned(l.loadStatus)) continue;
      const rec = receivedMap.get(String(l._id)) ?? 0;
      // Month received for KPI: only month earned loads
      if (new Date(l.createdAt).getTime() >= monthStart.getTime() || isCommissionEarned(l.loadStatus)) {
        // use earned loads for outstanding always; month received separately
      }
      commissionOutstanding = roundMoney(
        commissionOutstanding + Math.max(0, l.commissionAmount - rec)
      );
    }
    commissionReceived = roundMoney(
      monthLoads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce((s, l) => s + (receivedMap.get(String(l._id)) ?? 0), 0)
    );
    // Recompute outstanding only on earned loads in scope
    commissionOutstanding = 0;
    for (const l of allLoads) {
      if (!isCommissionEarned(l.loadStatus)) continue;
      const rec = receivedMap.get(String(l._id)) ?? 0;
      commissionOutstanding = roundMoney(
        commissionOutstanding + Math.max(0, l.commissionAmount - rec)
      );
    }

    const monthExpenses = roundMoney(
      expenses
        .filter((e) => new Date(e.date).getTime() >= monthStart.getTime())
        .reduce((s, e) => s + e.amount, 0)
    );

    // Outstanding by driver
    const assigns = await LoadAssignment.find({
      loadId: { $in: earnedLoadIds },
      releasedAt: null,
    }).lean();
    const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));
    const byDriver = new Map<
      string,
      { outstanding: number; earned: number; loads: Array<Record<string, unknown>> }
    >();

    for (const l of allLoads) {
      if (!isCommissionEarned(l.loadStatus)) continue;
      const a = assignByLoad.get(String(l._id));
      if (!a) continue;
      const did = String(a.driverId);
      const rec = receivedMap.get(String(l._id)) ?? 0;
      const outstanding = roundMoney(Math.max(0, l.commissionAmount - rec));
      if (outstanding <= 0) continue;
      if (!byDriver.has(did)) {
        byDriver.set(did, { outstanding: 0, earned: 0, loads: [] });
      }
      const b = byDriver.get(did)!;
      b.outstanding = roundMoney(b.outstanding + outstanding);
      b.earned = roundMoney(b.earned + l.commissionAmount);
      b.loads.push({
        loadId: String(l._id),
        loadNumber: l.loadNumber,
        outstanding,
        commissionAmount: l.commissionAmount,
        route: `${l.pickupCity} → ${l.deliveryCity}`,
      });
    }

    const driverIds = [...byDriver.keys()];
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));

    const outstandingByDriver = [...byDriver.entries()]
      .map(([id, b]) => ({
        driver: driverMap.get(id) ?? null,
        driverId: id,
        outstanding: b.outstanding,
        earned: b.earned,
        loads: b.loads,
      }))
      .sort((a, b) => b.outstanding - a.outstanding);

    // Alerts — overdue = unpaid past due (any non-cancelled / non-paid status)
    const overdueInvoices = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const inv of invoices) {
      if (
        inv.status === "PAID" ||
        inv.status === "CANCELLED"
      ) {
        continue;
      }
      const links = await InvoicePayment.find({ invoiceId: inv._id }).lean();
      const txs = await Transaction.find({
        _id: { $in: links.map((l) => l.transactionId) },
      }).lean();
      const paidTotal = roundMoney(txs.reduce((s, t) => s + t.amount, 0));
      const balance = roundMoney(Math.max(0, inv.amount - paidTotal));
      if (balance <= 0) continue;
      const due = new Date(inv.dueDate);
      due.setHours(0, 0, 0, 0);
      if (due < today) {
        overdueInvoices.push({
          id: String(inv._id),
          invoiceNumber: inv.invoiceNumber,
          amount: inv.amount,
          balance,
          dueDate: inv.dueDate,
        });
      }
    }

    const deliveredLoads = allLoads.filter(
      (l) => l.loadStatus === LoadStatus.DELIVERED
    );
    const podDocs =
      deliveredLoads.length > 0
        ? await DocumentModel.find({
            ...tenantFilter(scope),
            entityType: DocEntityType.LOAD,
            docType: DocType.POD,
            entityId: { $in: deliveredLoads.map((l) => String(l._id)) },
          })
            .select("entityId")
            .lean()
        : [];
    const loadsWithPod = new Set(podDocs.map((d) => String(d.entityId)));
    const missingPods = deliveredLoads
      .filter((l) => !loadsWithPod.has(String(l._id)))
      .slice(0, 20)
      .map((l) => ({
        id: String(l._id),
        loadNumber: l.loadNumber,
        route: `${l.pickupCity} → ${l.deliveryCity}`,
      }));

    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const now = new Date();
    const expiringDocs = docs
      .filter((d) => d.expiryDate && new Date(d.expiryDate) <= soon)
      .map((d) => ({
        id: String(d._id),
        fileName: d.fileName,
        docType: d.docType,
        expiryDate: d.expiryDate,
        expired: d.expiryDate ? new Date(d.expiryDate) < now : false,
      }))
      .slice(0, 20);

    const recentLoads = allLoads.slice(0, 8).map((l) => {
      const a = assignByLoad.get(String(l._id));
      return {
        ...serializeLoad(l),
        commissionEarned: isCommissionEarned(l.loadStatus),
        driverId: a ? String(a.driverId) : null,
      };
    });

    // attach driver names for recent
    const recentDriverIds = [
      ...new Set(recentLoads.map((l) => l.driverId).filter(Boolean) as string[]),
    ];
    const recentDrivers = await Driver.find({
      _id: { $in: recentDriverIds },
      ...tenantFilter(scope),
    }).lean();
    const rdMap = new Map(recentDrivers.map((d) => [String(d._id), d.name]));

    let users: Array<{ id: string; name: string; email: string }> = [];
    if (scope.isFullAccess && scope.accountType === "COMPANY") {
      const u = await User.find(tenantFilter(scope))
        .select("name email")
        .sort({ name: 1 })
        .lean();
      users = u.map((x) => ({
        id: String(x._id),
        name: x.name,
        email: x.email,
      }));
    }

    res.json({
      scope: {
        accountType: scope.accountType,
        role: scope.role,
        isFullAccess: scope.isFullAccess,
        filterUserId,
      },
      users,
      kpis: {
        users: usersCount,
        drivers: driversCount,
        trucks: trucksCount,
        activeLoads: allLoads.filter((l) => activeStatuses.has(l.loadStatus as never)).length,
        completedLoadsMonth: monthCompleted.length,
        totalLoadsMonth: monthLoads.length,
        grossLoadValue,
        commissionEarned,
        commissionReceived,
        commissionOutstanding,
        monthExpenses,
        netIncome: roundMoney(commissionEarned - monthExpenses),
        overdueInvoices: overdueInvoices.length,
        expiringDocuments: expiringDocs.length,
      },
      recentLoads: recentLoads.map((l) => ({
        ...l,
        driverName: l.driverId ? rdMap.get(l.driverId) ?? null : null,
      })),
      outstandingByDriver,
      alerts: {
        overdueInvoices,
        missingPods,
      },
    });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { isCommissionEarned, roundMoney } from "../lib/commission.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Expense } from "../models/Expense.js";
import { Transaction } from "../models/Transaction.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { Direction, TransactionType } from "../models/enums.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function parseRange(req: { query: Record<string, unknown> }) {
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  return { from, to };
}

function inRange(date: Date | string | null | undefined, from: Date | null, to: Date | null) {
  if (!date) return true;
  const d = new Date(date).getTime();
  if (from && d < from.getTime()) return false;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (d > end.getTime()) return false;
  }
  return true;
}

async function commissionReceivedMap(accountId: string, loadIds: mongoose.Types.ObjectId[]) {
  if (!loadIds.length) return new Map<string, number>();
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

reportsRouter.get("/summary", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const { from, to } = parseRange(req);
    const loads = (await Load.find(loadScopeFilter(scope)).lean()).filter((l) =>
      inRange(l.createdAt, from, to)
    );
    const expenses = (
      await Expense.find(
        scope.isFullAccess
          ? tenantFilter(scope)
          : { ...tenantFilter(scope), userId: scope.userId }
      ).lean()
    ).filter((e) => inRange(e.date, from, to));

    const receivedMap = await commissionReceivedMap(
      String(scope.accountId),
      loads.map((l) => l._id)
    );

    const grossRevenue = roundMoney(loads.reduce((s, l) => s + l.rate, 0));
    const commissionEarned = roundMoney(
      loads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce((s, l) => s + l.commissionAmount, 0)
    );
    const commissionReceived = roundMoney(
      loads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce((s, l) => s + (receivedMap.get(String(l._id)) ?? 0), 0)
    );
    const outstanding = roundMoney(
      loads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce(
          (s, l) => s + Math.max(0, l.commissionAmount - (receivedMap.get(String(l._id)) ?? 0)),
          0
        )
    );
    const expenseTotal = roundMoney(expenses.reduce((s, e) => s + e.amount, 0));

    res.json({
      grossRevenue,
      commissionEarned,
      commissionReceived,
      outstanding,
      expenseTotal,
      netIncome: roundMoney(commissionEarned - expenseTotal),
      loadCount: loads.length,
      completedLoads: loads.filter((l) => isCommissionEarned(l.loadStatus)).length,
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/commission", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const { from, to } = parseRange(req);
    const loads = (await Load.find(loadScopeFilter(scope)).lean()).filter((l) =>
      inRange(l.deliveryDateTime, from, to)
    );
    const receivedMap = await commissionReceivedMap(
      String(scope.accountId),
      loads.map((l) => l._id)
    );
    const assigns = await LoadAssignment.find({
      loadId: { $in: loads.map((l) => l._id) },
      releasedAt: null,
    }).lean();
    const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));
    const drivers = await Driver.find({
      _id: { $in: assigns.map((a) => a.driverId) },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), d.name]));

    res.json({
      rows: loads.map((l) => {
        const a = assignByLoad.get(String(l._id));
        const received = receivedMap.get(String(l._id)) ?? 0;
        return {
          loadNumber: l.loadNumber,
          loadStatus: l.loadStatus,
          driverName: a ? driverMap.get(String(a.driverId)) ?? null : null,
          rate: l.rate,
          commissionAmount: l.commissionAmount,
          received,
          outstanding: roundMoney(Math.max(0, l.commissionAmount - received)),
          earned: isCommissionEarned(l.loadStatus),
          route: `${l.pickupCity} → ${l.deliveryCity}`,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/drivers", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const drivers = await Driver.find(fleetScopeFilter(scope)).lean();
    const loads = await Load.find(loadScopeFilter(scope)).lean();
    const assigns = await LoadAssignment.find({
      loadId: { $in: loads.map((l) => l._id) },
      releasedAt: null,
    }).lean();
    const byDriverLoads = new Map<string, typeof loads>();
    for (const a of assigns) {
      const id = String(a.driverId);
      if (!byDriverLoads.has(id)) byDriverLoads.set(id, []);
      const load = loads.find((l) => String(l._id) === String(a.loadId));
      if (load) byDriverLoads.get(id)!.push(load);
    }

    res.json({
      rows: drivers.map((d) => {
        const dLoads = byDriverLoads.get(String(d._id)) ?? [];
        const earned = dLoads.filter((l) => isCommissionEarned(l.loadStatus));
        return {
          driverId: String(d._id),
          name: d.name,
          loadCount: dLoads.length,
          completedLoads: earned.length,
          grossRevenue: roundMoney(dLoads.reduce((s, l) => s + l.rate, 0)),
          commissionGenerated: roundMoney(
            earned.reduce((s, l) => s + l.commissionAmount, 0)
          ),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/trucks", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const trucks = await Truck.find(fleetScopeFilter(scope)).lean();
    const loads = await Load.find(loadScopeFilter(scope)).lean();
    const assigns = await LoadAssignment.find({
      loadId: { $in: loads.map((l) => l._id) },
      releasedAt: null,
    }).lean();
    const byTruck = new Map<string, typeof loads>();
    for (const a of assigns) {
      const id = String(a.truckId);
      if (!byTruck.has(id)) byTruck.set(id, []);
      const load = loads.find((l) => String(l._id) === String(a.loadId));
      if (load) byTruck.get(id)!.push(load);
    }

    res.json({
      rows: trucks.map((t) => {
        const tLoads = byTruck.get(String(t._id)) ?? [];
        return {
          truckId: String(t._id),
          unitNumber: t.unitNumber,
          loadCount: tLoads.length,
          grossRevenue: roundMoney(tLoads.reduce((s, l) => s + l.rate, 0)),
          commissionGenerated: roundMoney(
            tLoads
              .filter((l) => isCommissionEarned(l.loadStatus))
              .reduce((s, l) => s + l.commissionAmount, 0)
          ),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/expenses", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const { from, to } = parseRange(req);
    const expenses = (
      await Expense.find(
        scope.isFullAccess
          ? tenantFilter(scope)
          : { ...tenantFilter(scope), userId: scope.userId }
      ).lean()
    ).filter((e) => inRange(e.date, from, to));

    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.category] = roundMoney((byCategory[e.category] ?? 0) + e.amount);
    }

    const loads = (await Load.find(loadScopeFilter(scope)).lean()).filter((l) =>
      inRange(l.createdAt, from, to)
    );
    const commissionEarned = roundMoney(
      loads
        .filter((l) => isCommissionEarned(l.loadStatus))
        .reduce((s, l) => s + l.commissionAmount, 0)
    );
    const expenseTotal = roundMoney(expenses.reduce((s, e) => s + e.amount, 0));

    res.json({
      byCategory,
      expenseTotal,
      commissionEarned,
      netIncome: roundMoney(commissionEarned - expenseTotal),
      rows: expenses.map((e) => ({
        id: String(e._id),
        category: e.category,
        amount: e.amount,
        date: e.date,
        notes: e.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/activity", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...tenantFilter(scope) };
    if (!scope.isFullAccess) filter.userId = scope.userId;
    const logs = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({
      rows: logs.map((l) => ({
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        createdAt: l.createdAt,
        details: l.details,
      })),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/export", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const format = String(req.query.format || "csv").toLowerCase();
    const report = String(req.query.report || "commission");

    let headers: string[] = [];
    let rows: Array<Array<string | number>> = [];

    if (report === "commission") {
      const data = await (
        await fetchLikeCommission(scope)
      );
      headers = [
        "Load",
        "Driver",
        "Route",
        "Rate",
        "Commission",
        "Received",
        "Outstanding",
        "Status",
      ];
      rows = data.map((r) => [
        r.loadNumber,
        r.driverName ?? "",
        r.route,
        r.rate,
        r.commissionAmount,
        r.received,
        r.outstanding,
        r.loadStatus,
      ]);
    } else if (report === "drivers") {
      const drivers = await Driver.find(fleetScopeFilter(scope)).lean();
      headers = ["Driver", "Phone", "CDL", "Active"];
      rows = drivers.map((d) => [
        d.name,
        d.phone ?? "",
        d.cdlNumber ?? "",
        d.isActive ? "yes" : "no",
      ]);
    } else if (report === "expenses") {
      const expenses = await Expense.find(
        scope.isFullAccess
          ? tenantFilter(scope)
          : { ...tenantFilter(scope), userId: scope.userId }
      ).lean();
      headers = ["Date", "Category", "Amount", "Notes"];
      rows = expenses.map((e) => [
        new Date(e.date).toISOString().slice(0, 10),
        e.category,
        e.amount,
        e.notes ?? "",
      ]);
    } else {
      const loads = await Load.find(loadScopeFilter(scope)).lean();
      headers = ["Load", "Route", "Rate", "Commission", "Status"];
      rows = loads.map((l) => [
        l.loadNumber,
        `${l.pickupCity} → ${l.deliveryCity}`,
        l.rate,
        l.commissionAmount,
        l.loadStatus,
      ]);
    }

    if (format === "xlsx" || format === "excel") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(report);
      ws.addRow(headers);
      for (const row of rows) ws.addRow(row);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="truckops-${report}.xlsx"`
      );
      await wb.xlsx.write(res);
      res.end();
      return;
    }

    // CSV
    const escape = (v: string | number) => {
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join(
      "\n"
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="truckops-${report}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

async function fetchLikeCommission(scope: ReturnType<typeof getAccountScope>) {
  const loads = await Load.find(loadScopeFilter(scope)).lean();
  const receivedMap = await commissionReceivedMap(
    String(scope.accountId),
    loads.map((l) => l._id)
  );
  const assigns = await LoadAssignment.find({
    loadId: { $in: loads.map((l) => l._id) },
    releasedAt: null,
  }).lean();
  const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));
  const drivers = await Driver.find({
    _id: { $in: assigns.map((a) => a.driverId) },
  }).lean();
  const driverMap = new Map(drivers.map((d) => [String(d._id), d.name]));
  return loads.map((l) => {
    const a = assignByLoad.get(String(l._id));
    const received = receivedMap.get(String(l._id)) ?? 0;
    return {
      loadNumber: l.loadNumber,
      loadStatus: l.loadStatus,
      driverName: a ? driverMap.get(String(a.driverId)) ?? null : null,
      rate: l.rate,
      commissionAmount: l.commissionAmount,
      received,
      outstanding: roundMoney(Math.max(0, l.commissionAmount - received)),
      route: `${l.pickupCity} → ${l.deliveryCity}`,
    };
  });
}

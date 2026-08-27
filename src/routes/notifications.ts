import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { AppError } from "../middleware/errorHandler.js";
import { Notification } from "../models/Notification.js";
import { Invoice } from "../models/Invoice.js";
import { InvoicePayment } from "../models/InvoicePayment.js";
import { Transaction } from "../models/Transaction.js";
import { Load } from "../models/Load.js";
import { DocumentModel } from "../models/Document.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { deriveInvoiceStatus } from "../lib/invoice.js";
import { roundMoney } from "../lib/commission.js";
import { LoadStatus } from "../models/enums.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** Scan and upsert alert notifications for the current user/account */
async function refreshAlerts(scope: ReturnType<typeof getAccountScope>) {
  const userId = scope.userId;
  const accountId = scope.accountId;

  const invoices = await Invoice.find(
    scope.isFullAccess
      ? tenantFilter(scope)
      : { ...tenantFilter(scope), createdByUserId: userId }
  ).lean();

  for (const inv of invoices) {
    const links = await InvoicePayment.find({ invoiceId: inv._id }).lean();
    const txs = await Transaction.find({
      _id: { $in: links.map((l) => l.transactionId) },
    }).lean();
    const paid = roundMoney(txs.reduce((s, t) => s + t.amount, 0));
    const status = deriveInvoiceStatus({
      status: inv.status,
      dueDate: inv.dueDate,
      amount: inv.amount,
      paidTotal: paid,
    });
    if (status !== "OVERDUE") continue;
    const existing = await Notification.findOne({
      accountId,
      userId,
      type: "OVERDUE_INVOICE",
      message: { $regex: inv.invoiceNumber },
      readAt: null,
    }).lean();
    if (!existing) {
      await Notification.create({
        accountId,
        userId,
        type: "OVERDUE_INVOICE",
        message: `Invoice ${inv.invoiceNumber} is overdue`,
        link: `/invoices/${inv._id}`,
      });
    }
  }

  const delivered = await Load.find({
    ...loadScopeFilter(scope),
    loadStatus: LoadStatus.DELIVERED,
  })
    .limit(50)
    .lean();
  for (const l of delivered) {
    const existing = await Notification.findOne({
      accountId,
      userId,
      type: "MISSING_POD",
      message: { $regex: l.loadNumber },
      readAt: null,
    }).lean();
    if (!existing) {
      await Notification.create({
        accountId,
        userId,
        type: "MISSING_POD",
        message: `Load ${l.loadNumber} delivered — POD not received`,
        link: `/loads/${l._id}`,
      });
    }
  }

  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const docs = await DocumentModel.find({
    ...tenantFilter(scope),
    expiryDate: { $ne: null, $lte: soon },
  }).lean();
  for (const d of docs) {
    const existing = await Notification.findOne({
      accountId,
      userId,
      type: "DOC_EXPIRY",
      message: { $regex: d.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") },
      readAt: null,
    }).lean();
    if (!existing) {
      await Notification.create({
        accountId,
        userId,
        type: "DOC_EXPIRY",
        message: `Document "${d.fileName}" is expiring soon`,
        link: "/documents",
      });
    }
  }

  const drivers = await Driver.find(fleetScopeFilter(scope)).lean();
  for (const d of drivers) {
    if (d.licenseExpiry && new Date(d.licenseExpiry) <= soon) {
      const msg = `CDL/license for ${d.name} expiring soon`;
      const existing = await Notification.findOne({
        accountId,
        userId,
        type: "DOC_EXPIRY",
        message: msg,
        readAt: null,
      }).lean();
      if (!existing) {
        await Notification.create({
          accountId,
          userId,
          type: "DOC_EXPIRY",
          message: msg,
          link: `/fleet/drivers/${d._id}`,
        });
      }
    }
  }

  const trucks = await Truck.find(fleetScopeFilter(scope)).lean();
  for (const t of trucks) {
    if (t.inspectionExpiry && new Date(t.inspectionExpiry) <= soon) {
      const msg = `Inspection for truck #${t.unitNumber} expiring soon`;
      const existing = await Notification.findOne({
        accountId,
        userId,
        type: "DOC_EXPIRY",
        message: msg,
        readAt: null,
      }).lean();
      if (!existing) {
        await Notification.create({
          accountId,
          userId,
          type: "DOC_EXPIRY",
          message: msg,
          link: `/fleet/trucks/${t._id}`,
        });
      }
    }
  }
}

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    await refreshAlerts(scope);

    const notes = await Notification.find({
      accountId: scope.accountId,
      $or: [{ userId: scope.userId }, { userId: null }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      notifications: notes.map((n) => ({
        id: String(n._id),
        type: n.type,
        message: n.message,
        link: n.link ?? null,
        readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
      })),
      unread: notes.filter((n) => !n.readAt).length,
    });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/:id/read", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    await Notification.updateOne(
      {
        _id: req.params.id,
        accountId: scope.accountId,
        $or: [{ userId: scope.userId }, { userId: null }],
      },
      { $set: { readAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    await Notification.updateMany(
      {
        accountId: scope.accountId,
        readAt: null,
        $or: [{ userId: scope.userId }, { userId: null }],
      },
      { $set: { readAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { isCommissionEarned, roundMoney } from "../lib/commission.js";
import { agingBucket, deriveInvoiceStatus, sumAmounts } from "../lib/invoice.js";
import { logActivity } from "../lib/activity.js";
import {
  serializeDriver,
  serializeInvoice,
  serializeInvoiceItem,
  serializeLoad,
  serializeTransaction,
} from "../lib/serializers.js";
import { Invoice } from "../models/Invoice.js";
import { InvoiceItem } from "../models/InvoiceItem.js";
import { InvoicePayment } from "../models/InvoicePayment.js";
import { Transaction } from "../models/Transaction.js";
import { Driver } from "../models/Driver.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import {
  Direction,
  InvoiceKind,
  InvoiceStatus,
  TransactionType,
} from "../models/enums.js";
import {
  createInvoiceSchema,
  invoicePaymentSchema,
  sendInvoiceSchema,
  updateInvoiceStatusSchema,
} from "../validators/finance.js";
import { sendMail, isEmailConfigured } from "../lib/mail.js";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

async function nextInvoiceNumber(accountId: string): Promise<string> {
  const latest = await Invoice.findOne({ accountId })
    .sort({ createdAt: -1 })
    .select("invoiceNumber")
    .lean();
  let next = 1001;
  if (latest?.invoiceNumber) {
    const match = String(latest.invoiceNumber).match(/(\d+)\s*$/);
    if (match) next = Number(match[1]) + 1;
  }
  return `INV-${next}`;
}

async function paidTotalForInvoice(invoiceId: mongoose.Types.ObjectId): Promise<number> {
  const links = await InvoicePayment.find({ invoiceId }).lean();
  if (links.length === 0) return 0;
  const txs = await Transaction.find({
    _id: { $in: links.map((l) => l.transactionId) },
  }).lean();
  return roundMoney(txs.reduce((s, t) => s + t.amount, 0));
}

async function refreshInvoiceStatus(
  invoice: { _id: mongoose.Types.ObjectId; status: string; dueDate: Date; amount: number }
): Promise<string> {
  const paid = await paidTotalForInvoice(invoice._id);
  const next = deriveInvoiceStatus({
    status: invoice.status,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    paidTotal: paid,
  });
  if (next !== invoice.status) {
    await Invoice.updateOne({ _id: invoice._id }, { $set: { status: next } });
  }
  return next;
}

function invoiceListFilter(scope: ReturnType<typeof getAccountScope>) {
  const filter: Record<string, unknown> = { ...tenantFilter(scope) };
  if (!scope.isFullAccess) {
    filter.createdByUserId = scope.userId;
  }
  return filter;
}

invoicesRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter = invoiceListFilter(scope);
    if (req.query.driverId) filter.driverId = String(req.query.driverId);

    const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).lean();

    // Refresh overdue derivation
    const enriched = [];
    for (const inv of invoices) {
      const paidTotal = await paidTotalForInvoice(inv._id);
      const status = deriveInvoiceStatus({
        status: inv.status,
        dueDate: inv.dueDate,
        amount: inv.amount,
        paidTotal,
      });
      if (status !== inv.status) {
        await Invoice.updateOne({ _id: inv._id }, { $set: { status } });
      }
      enriched.push({ ...inv, status, paidTotal });
    }

    if (req.query.status) {
      const wanted = String(req.query.status);
      enriched.splice(
        0,
        enriched.length,
        ...enriched.filter((i) => i.status === wanted)
      );
    }

    const driverIds = [
      ...new Set(
        enriched
          .map((i) => (i.driverId ? String(i.driverId) : null))
          .filter(Boolean) as string[]
      ),
    ];
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      ...tenantFilter(scope),
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));

    res.json({
      invoices: enriched.map((i) => ({
        ...serializeInvoice(i),
        status: i.status,
        paidTotal: i.paidTotal,
        balance: roundMoney(Math.max(0, i.amount - i.paidTotal)),
        driver: i.driverId ? driverMap.get(String(i.driverId)) ?? null : null,
        aging: agingBucket(i.dueDate),
      })),
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.get("/aging", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const invoices = await Invoice.find({
      ...invoiceListFilter(scope),
      status: { $nin: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
    }).lean();

    const buckets: Record<string, number> = {
      current: 0,
      "1-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };

    const rows = [];
    for (const inv of invoices) {
      const paidTotal = await paidTotalForInvoice(inv._id);
      const balance = roundMoney(Math.max(0, inv.amount - paidTotal));
      if (balance <= 0) continue;
      const status = deriveInvoiceStatus({
        status: inv.status,
        dueDate: inv.dueDate,
        amount: inv.amount,
        paidTotal,
      });
      const bucket = agingBucket(inv.dueDate);
      buckets[bucket] = roundMoney((buckets[bucket] ?? 0) + balance);
      rows.push({
        ...serializeInvoice({ ...inv, status }),
        paidTotal,
        balance,
        aging: bucket,
      });
    }

    res.json({ buckets, invoices: rows });
  } catch (err) {
    next(err);
  }
});

/** Loads eligible to invoice for a driver (earned, not already on an active invoice) */
invoicesRouter.get("/eligible-loads/:driverId", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const driverId = req.params.driverId;
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      throw new AppError("Invalid driverId", 400);
    }

    const assigns = await LoadAssignment.find({
      driverId,
      releasedAt: null,
    })
      .select("loadId")
      .lean();

    const loads = await Load.find({
      ...loadScopeFilter(scope),
      _id: { $in: assigns.map((a) => a.loadId) },
      loadStatus: {
        $in: [
          "DELIVERED",
          "POD_RECEIVED",
          "PAYMENT_FOLLOW_UP",
          "PAYMENT_COMPLETED",
        ],
      },
    }).lean();

    const eligible = [];
    for (const l of loads) {
      const items = await InvoiceItem.find({ loadId: l._id }).lean();
      let onCommissionInvoice = false;
      for (const item of items) {
        const inv = await Invoice.findOne({
          _id: item.invoiceId,
          status: { $ne: InvoiceStatus.CANCELLED },
        }).lean();
        if (!inv) continue;
        const kind = inv.kind ?? InvoiceKind.COMMISSION;
        if (kind === InvoiceKind.COMMISSION) {
          onCommissionInvoice = true;
          break;
        }
      }
      if (onCommissionInvoice) continue;
      eligible.push(serializeLoad(l));
    }

    res.json({ loads: eligible });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.get("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const invoice = await Invoice.findOne({
      ...invoiceListFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!invoice) throw new AppError("Invoice not found", 404);

    const [items, paymentLinks, driver] = await Promise.all([
      InvoiceItem.find({ invoiceId: invoice._id }).lean(),
      InvoicePayment.find({ invoiceId: invoice._id }).lean(),
      Driver.findOne({ _id: invoice.driverId, ...tenantFilter(scope) }).lean(),
    ]);

    const loadIds = items.map((i) => i.loadId);
    const loads = await Load.find({
      _id: { $in: loadIds },
      ...tenantFilter(scope),
    }).lean();
    const loadMap = new Map(loads.map((l) => [String(l._id), serializeLoad(l)]));

    const txIds = paymentLinks.map((p) => p.transactionId);
    const txs = await Transaction.find({ _id: { $in: txIds } }).lean();
    const paidTotal = roundMoney(txs.reduce((s, t) => s + t.amount, 0));
    const status = await refreshInvoiceStatus({ ...invoice, status: invoice.status });

    res.json({
      invoice: {
        ...serializeInvoice({ ...invoice, status }),
        paidTotal,
        balance: roundMoney(Math.max(0, invoice.amount - paidTotal)),
        aging: agingBucket(invoice.dueDate),
      },
      driver: driver ? serializeDriver(driver) : null,
      items: items.map((i) => ({
        ...serializeInvoiceItem(i),
        load: loadMap.get(String(i.loadId)) ?? null,
      })),
      payments: txs.map(serializeTransaction),
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createInvoiceSchema.parse(req.body);

    const driver = await Driver.findOne({
      ...fleetScopeFilter(scope),
      _id: input.driverId,
    }).lean();
    if (!driver) throw new AppError("Driver not found", 404);

    const loadIds = input.loadIds;
    for (const id of loadIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid loadId", 400);
      }
    }

    const loads = await Load.find({
      ...loadScopeFilter(scope),
      _id: { $in: loadIds },
    }).lean();
    if (loads.length !== loadIds.length) {
      throw new AppError("One or more loads not found", 404);
    }

    for (const load of loads) {
      if (!isCommissionEarned(load.loadStatus)) {
        throw new AppError(
          `Load ${load.loadNumber} commission is not earned yet`,
          400
        );
      }
      if (load.loadStatus === "CANCELLED") {
        throw new AppError(`Load ${load.loadNumber} is cancelled`, 400);
      }

      const assign = await LoadAssignment.findOne({
        loadId: load._id,
        releasedAt: null,
      }).lean();
      if (!assign || String(assign.driverId) !== String(driver._id)) {
        throw new AppError(
          `Load ${load.loadNumber} is not assigned to this driver`,
          400
        );
      }

      // Prevent double-invoicing commission for a load
      const existingItems = await InvoiceItem.find({ loadId: load._id }).lean();
      for (const existingItem of existingItems) {
        const existingInv = await Invoice.findOne({
          _id: existingItem.invoiceId,
          status: { $ne: InvoiceStatus.CANCELLED },
        }).lean();
        if (!existingInv) continue;
        const kind = existingInv.kind ?? InvoiceKind.COMMISSION;
        if (kind === InvoiceKind.COMMISSION) {
          throw new AppError(
            `Load ${load.loadNumber} is already on invoice ${existingInv.invoiceNumber}`,
            409
          );
        }
      }
    }

    const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(String(scope.accountId)));
    const amount = sumAmounts(loads.map((l) => l.commissionAmount));

    const invoice = await Invoice.create({
      accountId: scope.accountId,
      invoiceNumber,
      kind: InvoiceKind.COMMISSION,
      driverId: driver._id,
      billTo: null,
      createdByUserId: scope.userId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      amount,
      status: InvoiceStatus.DRAFT,
      notes: input.notes,
    });

    await InvoiceItem.insertMany(
      loads.map((l) => ({
        invoiceId: invoice._id,
        loadId: l._id,
        description: `Commission · ${l.loadNumber} · ${l.pickupCity} → ${l.deliveryCity}`,
        amount: l.commissionAmount,
      }))
    );

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "INVOICE_CREATED",
      details: { invoiceNumber, amount, loadIds },
    });

    res.status(201).json({ invoice: serializeInvoice(invoice.toObject()) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post("/:id/send", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = sendInvoiceSchema.parse(req.body);

    const invoice = await Invoice.findOne({
      ...invoiceListFilter(scope),
      _id: id,
    }).lean();
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      throw new AppError("Cannot email a paid or cancelled invoice", 400);
    }

    if (!isEmailConfigured()) {
      throw new AppError(
        "Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to the backend .env file.",
        503
      );
    }

    const [items, driver, paidTotal] = await Promise.all([
      InvoiceItem.find({ invoiceId: invoice._id }).lean(),
      invoice.driverId
        ? Driver.findOne({ _id: invoice.driverId, ...tenantFilter(scope) }).lean()
        : Promise.resolve(null),
      paidTotalForInvoice(invoice._id),
    ]);

    const billTo =
      invoice.kind === InvoiceKind.FREIGHT
        ? invoice.billTo || "Customer"
        : driver?.name || "Driver";
    const balance = roundMoney(Math.max(0, invoice.amount - paidTotal));
    const kindLabel =
      invoice.kind === InvoiceKind.FREIGHT ? "Freight" : "Commission";
    const issue = invoice.issueDate
      ? new Date(invoice.issueDate).toLocaleDateString()
      : "—";
    const due = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString()
      : "—";

    const linesHtml = items
      .map(
        (i) =>
          `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(
            i.description
          )}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">$${Number(
            i.amount
          ).toFixed(2)}</td></tr>`
      )
      .join("");

    const noteBlock = input.message
      ? `<p style="margin-top:16px;color:#475569;">${escapeHtml(input.message)}</p>`
      : "";

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;">
        <p style="letter-spacing:0.2em;text-transform:uppercase;color:#d97706;font-size:12px;">TruckOps</p>
        <h1 style="margin:8px 0 4px;font-size:24px;">${escapeHtml(invoice.invoiceNumber)}</h1>
        <p style="color:#64748b;margin:0 0 20px;">${kindLabel} invoice</p>
        <p><strong>Bill to:</strong> ${escapeHtml(billTo)}</p>
        <p><strong>Issue:</strong> ${issue} &nbsp;·&nbsp; <strong>Due:</strong> ${due}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:20px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1;">Description</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #cbd5e1;">Amount</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
        <p style="text-align:right;margin-top:16px;font-size:18px;"><strong>Total: $${Number(
          invoice.amount
        ).toFixed(2)}</strong></p>
        <p style="text-align:right;color:#64748b;">Balance due: $${balance.toFixed(2)}</p>
        ${noteBlock}
        <p style="margin-top:28px;font-size:12px;color:#94a3b8;">Sent from TruckOps via Gmail.</p>
      </div>
    `;

    const text = [
      `TruckOps invoice ${invoice.invoiceNumber}`,
      `${kindLabel} invoice`,
      `Bill to: ${billTo}`,
      `Issue: ${issue}`,
      `Due: ${due}`,
      ...items.map((i) => `- ${i.description}: $${Number(i.amount).toFixed(2)}`),
      `Total: $${Number(invoice.amount).toFixed(2)}`,
      `Balance due: $${balance.toFixed(2)}`,
      input.message ? `\n${input.message}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendMail({
      to: input.email,
      subject: `Invoice ${invoice.invoiceNumber} · $${Number(invoice.amount).toFixed(2)}`,
      text,
      html,
    });

    const status = deriveInvoiceStatus({
      status: InvoiceStatus.SENT,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      paidTotal,
    });

    await Invoice.updateOne({ _id: invoice._id }, { $set: { status } });
    const updated = await Invoice.findById(invoice._id).lean();
    if (!updated) throw new AppError("Invoice not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "INVOICE_EMAILED",
      details: { status, email: input.email },
    });

    res.json({
      invoice: serializeInvoice(updated),
      emailedTo: input.email,
    });
  } catch (err) {
    next(err);
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

invoicesRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const invoice = await Invoice.findOneAndUpdate(
      {
        ...invoiceListFilter(scope),
        _id: req.params.id,
        status: { $nin: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
      },
      { $set: { status: InvoiceStatus.CANCELLED } },
      { new: true }
    ).lean();
    if (!invoice) throw new AppError("Invoice not found or cannot be cancelled", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "INVOICE_CANCELLED",
    });

    res.json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post("/:id/status", setInvoiceStatus);
invoicesRouter.patch("/:id/status", setInvoiceStatus);

async function setInvoiceStatus(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  try {
    const scope = getAccountScope(req.session!);
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = updateInvoiceStatusSchema.parse(req.body);
    const invoice = await Invoice.findOne({
      ...invoiceListFilter(scope),
      _id: id,
    }).lean();
    if (!invoice) throw new AppError("Invoice not found", 404);

    if (
      invoice.status === InvoiceStatus.CANCELLED &&
      input.status !== InvoiceStatus.CANCELLED
    ) {
      throw new AppError("Cancelled invoices cannot be reopened", 400);
    }

    const updated = await Invoice.findOneAndUpdate(
      { _id: invoice._id },
      { $set: { status: input.status } },
      { new: true }
    ).lean();
    if (!updated) throw new AppError("Invoice not found", 404);

    if (input.status === InvoiceStatus.PAID) {
      const items = await InvoiceItem.find({ invoiceId: invoice._id }).lean();
      const kind = invoice.kind ?? InvoiceKind.COMMISSION;
      if (kind === InvoiceKind.FREIGHT) {
        await Load.updateMany(
          { _id: { $in: items.map((i) => i.loadId) } },
          { $set: { rateSettled: true } }
        );
      } else {
        await Load.updateMany(
          { _id: { $in: items.map((i) => i.loadId) } },
          { $set: { commissionSettled: true } }
        );
      }
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "INVOICE_STATUS_CHANGED",
      details: { from: invoice.status, to: input.status },
    });

    res.json({ invoice: serializeInvoice(updated) });
  } catch (err) {
    next(err);
  }
}

invoicesRouter.post("/:id/payments", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = invoicePaymentSchema.parse(req.body);
    if (input.amount <= 0) throw new AppError("Amount must be positive", 400);

    const invoice = await Invoice.findOne({
      ...invoiceListFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError("Cannot record payment on a cancelled invoice", 400);
    }

    const already = await paidTotalForInvoice(invoice._id);
    const kind = invoice.kind ?? InvoiceKind.COMMISSION;
    const items = await InvoiceItem.find({ invoiceId: invoice._id }).lean();
    const freightLoadId =
      kind === InvoiceKind.FREIGHT && items[0] ? items[0].loadId : null;

    const tx = await Transaction.create({
      accountId: scope.accountId,
      loadId: freightLoadId,
      driverId: invoice.driverId,
      createdByUserId: scope.userId,
      type:
        kind === InvoiceKind.FREIGHT
          ? TransactionType.FREIGHT_RECEIVED
          : TransactionType.COMMISSION_RECEIVED,
      direction: Direction.IN,
      amount: roundMoney(input.amount),
      date: input.date,
      method: input.method,
      reference: input.reference,
      notes: input.notes ?? `Payment for ${invoice.invoiceNumber}`,
    });

    await InvoicePayment.create({
      invoiceId: invoice._id,
      transactionId: tx._id,
    });

    const paidTotal = roundMoney(already + input.amount);
    const statusBase =
      invoice.status === InvoiceStatus.DRAFT
        ? InvoiceStatus.SENT
        : invoice.status;
    const status = deriveInvoiceStatus({
      status: statusBase,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      paidTotal,
    });
    await Invoice.updateOne({ _id: invoice._id }, { $set: { status } });

    if (status === InvoiceStatus.PAID) {
      if (kind === InvoiceKind.FREIGHT) {
        await Load.updateMany(
          { _id: { $in: items.map((i) => i.loadId) } },
          { $set: { rateSettled: true } }
        );
      } else {
        await Load.updateMany(
          { _id: { $in: items.map((i) => i.loadId) } },
          { $set: { commissionSettled: true } }
        );
      }
    } else if (kind === InvoiceKind.FREIGHT && freightLoadId) {
      const load = await Load.findById(freightLoadId).lean();
      if (load) {
        const { refreshRateSettled } = await import("../lib/freight.js");
        await refreshRateSettled(scope.accountId, load);
      }
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "INVOICE_PAYMENT",
      details: { amount: input.amount, paidTotal, status, kind },
    });

    res.status(201).json({
      transaction: serializeTransaction(tx.toObject()),
      paidTotal,
      balance: roundMoney(Math.max(0, invoice.amount - paidTotal)),
      status,
    });
  } catch (err) {
    next(err);
  }
});

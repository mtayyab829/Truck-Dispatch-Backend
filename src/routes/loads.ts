import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { logActivity } from "../lib/activity.js";
import {
  calculateCommissionAmount,
  isCommissionEarned,
  roundMoney,
} from "../lib/commission.js";
import { freightReceivedTotal, refreshRateSettled } from "../lib/freight.js";
import { loadScopeFilter, nextLoadNumber } from "../lib/loadHelpers.js";
import { canTransition, nextStatuses, FREIGHT_PAYMENT_STATUSES } from "../lib/loadStatus.js";
import { uploadDocumentToCloudinary } from "../lib/cloudinary.js";
import { extractEmail, suggestedInvoiceRecipientEmail } from "../lib/emailHelpers.js";
import { sendMail, isEmailConfigured } from "../lib/mail.js";
import {
  serializeDocument,
  serializeDriver,
  serializeInvoice,
  serializeLoad,
  serializeLoadAssignment,
  serializeStatusHistory,
  serializeTransaction,
  serializeTruck,
} from "../lib/serializers.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { LoadStatusHistory } from "../models/LoadStatusHistory.js";
import { DocumentModel } from "../models/Document.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Transaction } from "../models/Transaction.js";
import { Invoice } from "../models/Invoice.js";
import { InvoiceItem } from "../models/InvoiceItem.js";
import { Notification } from "../models/Notification.js";
import {
  LoadStatus,
  DocEntityType,
  DocType,
  Direction,
  InvoiceKind,
  InvoiceStatus,
  TransactionType,
} from "../models/enums.js";
import {
  assignLoadSchema,
  changeStatusSchema,
  createLoadSchema,
  updateLoadSchema,
  uploadMetaSchema,
} from "../validators/loads.js";
import {
  createFreightInvoiceSchema,
  recordFreightPaymentSchema,
} from "../validators/finance.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowedMimes = new Set([
      "application/pdf",
      "application/x-pdf",
      "image/jpeg",
      "image/jpg",
      "image/pjpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    const allowedExt = new Set([
      ".pdf",
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".doc",
      ".docx",
    ]);
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    // Prefer extension — Windows often sends empty / octet-stream for PDFs
    if (allowedExt.has(ext) || allowedMimes.has(mime)) {
      cb(null, true);
      return;
    }
    cb(new Error("File type not allowed. Use PDF, JPG, PNG, WEBP, or Word."));
  },
});

export const loadsRouter = Router();
loadsRouter.use(requireAuth);

function assertObjectId(id: string, label = "id"): void {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
}

async function getScopedLoad(scope: ReturnType<typeof getAccountScope>, id: string) {
  assertObjectId(id, "loadId");
  const load = await Load.findOne({ ...loadScopeFilter(scope), _id: id }).lean();
  if (!load) throw new AppError("Load not found", 404);
  return load;
}

async function assertScopedDriverTruck(
  scope: ReturnType<typeof getAccountScope>,
  driverId: string,
  truckId: string
) {
  assertObjectId(driverId, "driverId");
  assertObjectId(truckId, "truckId");
  const [driver, truck] = await Promise.all([
    Driver.findOne({ ...fleetScopeFilter(scope), _id: driverId, isActive: true }).lean(),
    Truck.findOne({ ...fleetScopeFilter(scope), _id: truckId, isActive: true }).lean(),
  ]);
  if (!driver) throw new AppError("Driver not found or out of scope", 404);
  if (!truck) throw new AppError("Truck not found or out of scope", 404);
  return { driver, truck };
}

async function activeAssignment(loadId: string) {
  return LoadAssignment.findOne({ loadId, releasedAt: null }).sort({ assignedAt: -1 }).lean();
}

loadsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...loadScopeFilter(scope) };
    if (req.query.status) filter.loadStatus = String(req.query.status);
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
    const assigns = await LoadAssignment.find({
      loadId: { $in: loadIds },
      releasedAt: null,
    }).lean();
    const assignByLoad = new Map(assigns.map((a) => [String(a.loadId), a]));

    const driverIds = [...new Set(assigns.map((a) => String(a.driverId)))];
    const truckIds = [...new Set(assigns.map((a) => String(a.truckId)))];
    const [drivers, trucks] = await Promise.all([
      Driver.find({ _id: { $in: driverIds }, ...tenantFilter(scope) }).lean(),
      Truck.find({ _id: { $in: truckIds }, ...tenantFilter(scope) }).lean(),
    ]);
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));
    const truckMap = new Map(trucks.map((t) => [String(t._id), serializeTruck(t)]));

    res.json({
      loads: loads.map((l) => {
        const a = assignByLoad.get(String(l._id));
        return {
          ...serializeLoad(l),
          commissionEarned: isCommissionEarned(l.loadStatus),
          driver: a ? driverMap.get(String(a.driverId)) ?? null : null,
          truck: a ? truckMap.get(String(a.truckId)) ?? null : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

loadsRouter.get("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);

    const [assignments, history, documents] = await Promise.all([
      LoadAssignment.find({ loadId: load._id }).sort({ assignedAt: -1 }).lean(),
      LoadStatusHistory.find({ loadId: load._id }).sort({ changedAt: 1 }).lean(),
      DocumentModel.find({
        ...tenantFilter(scope),
        entityType: DocEntityType.LOAD,
        entityId: String(load._id),
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const driverIds = [...new Set(assignments.map((a) => String(a.driverId)))];
    const truckIds = [...new Set(assignments.map((a) => String(a.truckId)))];
    const [drivers, trucks] = await Promise.all([
      Driver.find({ _id: { $in: driverIds }, ...tenantFilter(scope) }).lean(),
      Truck.find({ _id: { $in: truckIds }, ...tenantFilter(scope) }).lean(),
    ]);
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));
    const truckMap = new Map(trucks.map((t) => [String(t._id), serializeTruck(t)]));

    const current = assignments.find((a) => !a.releasedAt) ?? null;
    const hasPod = documents.some((d) => d.docType === DocType.POD);
    const hasBol = documents.some((d) => d.docType === DocType.BOL);

    const freightPayments = await Transaction.find({
      ...tenantFilter(scope),
      loadId: load._id,
      type: TransactionType.FREIGHT_RECEIVED,
      direction: Direction.IN,
    })
      .sort({ date: -1 })
      .lean();
    const freightReceived = await freightReceivedTotal(scope.accountId, load._id);
    const freightOutstanding = roundMoney(Math.max(0, load.rate - freightReceived));

    const commissionAgg = await Transaction.aggregate([
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
    const commissionReceived = roundMoney((commissionAgg[0]?.total as number) ?? 0);
    const commissionOutstanding = roundMoney(
      Math.max(0, load.commissionAmount - commissionReceived)
    );

    const commissionPayments = await Transaction.find({
      ...tenantFilter(scope),
      loadId: load._id,
      type: TransactionType.COMMISSION_RECEIVED,
      direction: Direction.IN,
    })
      .sort({ date: -1 })
      .lean();

    const freightItems = await InvoiceItem.find({ loadId: load._id }).lean();
    let freightInvoice = null;
    for (const item of freightItems) {
      const inv = await Invoice.findOne({
        _id: item.invoiceId,
        kind: InvoiceKind.FREIGHT,
        status: { $ne: InvoiceStatus.CANCELLED },
      }).lean();
      if (inv) {
        freightInvoice = serializeInvoice(inv);
        break;
      }
    }

    let availableNext = nextStatuses(load.loadStatus);
    if (
      availableNext.includes(LoadStatus.PAYMENT_COMPLETED) &&
      freightOutstanding > 0.001
    ) {
      availableNext = availableNext.filter((s) => s !== LoadStatus.PAYMENT_COMPLETED);
    }

    res.json({
      load: {
        ...serializeLoad(load),
        commissionEarned: isCommissionEarned(load.loadStatus),
      },
      currentAssignment: current
        ? {
            ...serializeLoadAssignment(current),
            driver: driverMap.get(String(current.driverId)) ?? null,
            truck: truckMap.get(String(current.truckId)) ?? null,
          }
        : null,
      assignmentHistory: assignments.map((a) => ({
        ...serializeLoadAssignment(a),
        driver: driverMap.get(String(a.driverId)) ?? null,
        truck: truckMap.get(String(a.truckId)) ?? null,
      })),
      statusHistory: history.map(serializeStatusHistory),
      documents: documents.map(serializeDocument),
      nextStatuses: availableNext,
      hasPod,
      hasBol,
      freightPayment: {
        rate: load.rate,
        received: freightReceived,
        outstanding: freightOutstanding,
        settled: Boolean(load.rateSettled) || freightOutstanding <= 0,
        payments: freightPayments.map(serializeTransaction),
        invoice: freightInvoice,
      },
      commissionPayment: {
        amount: load.commissionAmount,
        received: commissionReceived,
        outstanding: commissionOutstanding,
        settled:
          Boolean(load.commissionSettled) || commissionOutstanding <= 0,
        earned: isCommissionEarned(load.loadStatus),
        payments: commissionPayments.map(serializeTransaction),
      },
    });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createLoadSchema.parse(req.body);

    const loadNumber = input.loadNumber ?? (await nextLoadNumber(scope));
    const existing = await Load.findOne({
      ...tenantFilter(scope),
      loadNumber,
    }).lean();
    if (existing) throw new AppError("Load number already exists", 409);

    const commissionAmount = calculateCommissionAmount(
      input.rate,
      input.commissionType,
      input.commissionValue
    );

    let status: (typeof LoadStatus)[keyof typeof LoadStatus] = LoadStatus.CREATED;
    let driverId = input.driverId;
    let truckId = input.truckId;

    if (driverId || truckId) {
      if (!driverId || !truckId) {
        throw new AppError("Both driverId and truckId are required to assign", 400);
      }
      await assertScopedDriverTruck(scope, driverId, truckId);
      status = LoadStatus.ASSIGNED;
    }

    const load = await Load.create({
      accountId: scope.accountId,
      ownerUserId: scope.userId,
      loadNumber,
      source: input.source,
      pickupCity: input.pickupCity,
      pickupState: input.pickupState,
      pickupDateTime: input.pickupDateTime,
      deliveryCity: input.deliveryCity,
      deliveryState: input.deliveryState,
      deliveryDateTime: input.deliveryDateTime,
      equipment: input.equipment,
      commodity: input.commodity,
      weight: input.weight,
      miles: input.miles,
      rate: input.rate,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue,
      commissionAmount,
      loadStatus: status,
      notes: input.notes,
    });

    await LoadStatusHistory.create({
      loadId: load._id,
      status: LoadStatus.CREATED,
      changedByUserId: scope.userId,
      note: "Load created",
    });

    if (status === LoadStatus.ASSIGNED && driverId && truckId) {
      await LoadAssignment.create({
        loadId: load._id,
        driverId,
        truckId,
        assignedUserId: scope.userId,
      });
      await LoadStatusHistory.create({
        loadId: load._id,
        status: LoadStatus.ASSIGNED,
        changedByUserId: scope.userId,
        note: "Assigned on create",
      });
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "LOAD_CREATED",
      details: { loadNumber, status, commissionAmount },
    });

    res.status(201).json({ load: serializeLoad(load.toObject()) });
  } catch (err) {
    next(err);
  }
});

loadsRouter.patch("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const existing = await getScopedLoad(scope, req.params.id);
    const input = updateLoadSchema.parse(req.body);

    if (existing.commissionSettled) {
      const touchingMoney =
        input.rate !== undefined ||
        input.commissionType !== undefined ||
        input.commissionValue !== undefined;
      if (touchingMoney) {
        throw new AppError("Cannot change commission on a settled load", 400);
      }
    }

    const rate = input.rate ?? existing.rate;
    const commissionType = input.commissionType ?? existing.commissionType;
    const commissionValue = input.commissionValue ?? existing.commissionValue;
    const commissionAmount = calculateCommissionAmount(
      rate,
      commissionType,
      commissionValue
    );

    if (input.loadNumber && input.loadNumber !== existing.loadNumber) {
      const clash = await Load.findOne({
        ...tenantFilter(scope),
        loadNumber: input.loadNumber,
        _id: { $ne: existing._id },
      }).lean();
      if (clash) throw new AppError("Load number already exists", 409);
    }

    const { driverId: _d, truckId: _t, ...rest } = input as typeof input & {
      driverId?: string;
      truckId?: string;
    };

    const load = await Load.findOneAndUpdate(
      { ...loadScopeFilter(scope), _id: req.params.id },
      { $set: { ...rest, rate, commissionType, commissionValue, commissionAmount } },
      { new: true }
    ).lean();

    if (!load) throw new AppError("Load not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "LOAD_UPDATED",
      details: { commissionAmount },
    });

    res.json({ load: serializeLoad(load) });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);
    if (load.loadStatus === LoadStatus.CANCELLED) {
      throw new AppError("Cannot assign a cancelled load", 400);
    }

    const input = assignLoadSchema.parse(req.body);
    await assertScopedDriverTruck(scope, input.driverId, input.truckId);

    const current = await activeAssignment(String(load._id));
    if (current) {
      await LoadAssignment.updateOne(
        { _id: current._id },
        { $set: { releasedAt: new Date() } }
      );
    }

    const assignment = await LoadAssignment.create({
      loadId: load._id,
      driverId: input.driverId,
      truckId: input.truckId,
      assignedUserId: scope.userId,
    });

    let updated = load;
    if (
      load.loadStatus === LoadStatus.CREATED ||
      !current
    ) {
      // Move to ASSIGNED if still CREATED
      if (load.loadStatus === LoadStatus.CREATED) {
        updated =
          (await Load.findOneAndUpdate(
            { _id: load._id },
            { $set: { loadStatus: LoadStatus.ASSIGNED } },
            { new: true }
          ).lean()) ?? load;

        await LoadStatusHistory.create({
          loadId: load._id,
          status: LoadStatus.ASSIGNED,
          changedByUserId: scope.userId,
          note: "Driver/truck assigned",
        });
      }
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "LOAD_ASSIGNED",
      details: { driverId: input.driverId, truckId: input.truckId },
    });

    res.json({
      load: serializeLoad(updated),
      assignment: serializeLoadAssignment(assignment.toObject()),
    });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post("/:id/status", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);
    const input = changeStatusSchema.parse(req.body);

    if (!canTransition(load.loadStatus, input.status)) {
      throw new AppError(
        `Cannot change status from ${load.loadStatus} to ${input.status}`,
        400
      );
    }

    if (
      input.status !== LoadStatus.CREATED &&
      input.status !== LoadStatus.CANCELLED &&
      load.loadStatus === LoadStatus.CREATED
    ) {
      // ASSIGNED requires an assignment
    }
    if (input.status === LoadStatus.ASSIGNED || FLOW_REQUIRES_ASSIGNMENT(input.status)) {
      const current = await activeAssignment(String(load._id));
      if (!current && input.status !== LoadStatus.CANCELLED) {
        throw new AppError("Assign a driver and truck before advancing status", 400);
      }
    }

    if (input.status === LoadStatus.PICKED_UP) {
      const bol = await DocumentModel.findOne({
        ...tenantFilter(scope),
        entityType: DocEntityType.LOAD,
        entityId: String(load._id),
        docType: DocType.BOL,
      }).lean();
      if (!bol) {
        throw new AppError(
          "Upload a BOL document before marking picked up",
          400
        );
      }
    }

    if (input.status === LoadStatus.POD_RECEIVED) {
      const pod = await DocumentModel.findOne({
        ...tenantFilter(scope),
        entityType: DocEntityType.LOAD,
        entityId: String(load._id),
        docType: DocType.POD,
      }).lean();
      if (!pod) {
        throw new AppError(
          "Upload a POD document before marking POD received",
          400
        );
      }
    }

    if (input.status === LoadStatus.PAYMENT_COMPLETED) {
      const received = await freightReceivedTotal(scope.accountId, load._id);
      if (received + 0.001 < load.rate) {
        throw new AppError(
          "Record full freight payment before marking payment completed",
          400
        );
      }
    }

    const updated = await Load.findOneAndUpdate(
      { ...loadScopeFilter(scope), _id: load._id },
      { $set: { loadStatus: input.status } },
      { new: true }
    ).lean();

    if (!updated) throw new AppError("Load not found", 404);

    const history = await LoadStatusHistory.create({
      loadId: load._id,
      status: input.status,
      changedByUserId: scope.userId,
      note: input.note,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "LOAD_STATUS_CHANGED",
      details: { from: load.loadStatus, to: input.status, note: input.note },
    });

    res.json({
      load: serializeLoad(updated),
      statusHistory: serializeStatusHistory(history.toObject()),
      nextStatuses: nextStatuses(updated.loadStatus),
    });
  } catch (err) {
    next(err);
  }
});

function FLOW_REQUIRES_ASSIGNMENT(status: string): boolean {
  return ![LoadStatus.CREATED, LoadStatus.CANCELLED].includes(status as never);
}

async function nextFreightInvoiceNumber(accountId: string): Promise<string> {
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

loadsRouter.post("/:id/freight-payment", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);
    const input = recordFreightPaymentSchema.parse(req.body);
    if (input.amount <= 0) throw new AppError("Amount must be positive", 400);

    const assignment = await activeAssignment(String(load._id));
    if (!assignment) {
      throw new AppError("Assign a driver and truck before recording payment", 400);
    }
    if (!FREIGHT_PAYMENT_STATUSES.has(load.loadStatus)) {
      throw new AppError(
        "Freight payment can only be recorded at the POD received / payment step",
        400
      );
    }

    const received = await freightReceivedTotal(scope.accountId, load._id);
    const outstanding = roundMoney(Math.max(0, load.rate - received));
    if (outstanding <= 0) {
      throw new AppError("Load freight is already fully paid", 400);
    }
    if (input.amount > outstanding + 0.001) {
      throw new AppError(
        `Amount exceeds outstanding freight (${outstanding})`,
        400
      );
    }

    const tx = await Transaction.create({
      accountId: scope.accountId,
      loadId: load._id,
      driverId: assignment.driverId,
      createdByUserId: scope.userId,
      type: TransactionType.FREIGHT_RECEIVED,
      direction: Direction.IN,
      amount: roundMoney(input.amount),
      date: input.date,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
    });

    const settled = await refreshRateSettled(scope.accountId, load);

    // Auto-complete payment step when fully paid
    if (settled.settled && FREIGHT_PAYMENT_STATUSES.has(load.loadStatus)) {
      await Load.updateOne(
        { _id: load._id },
        { $set: { loadStatus: LoadStatus.PAYMENT_COMPLETED } }
      );
      await LoadStatusHistory.create({
        loadId: load._id,
        status: LoadStatus.PAYMENT_COMPLETED,
        changedByUserId: scope.userId,
        note: "Auto-advanced after full freight payment",
      });
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "FREIGHT_PAYMENT_RECORDED",
      details: {
        amount: input.amount,
        received: settled.received,
        autoCompleted: settled.settled,
      },
    });

    res.status(201).json({
      payment: serializeTransaction(tx.toObject()),
      freightPayment: {
        rate: load.rate,
        received: settled.received,
        outstanding: roundMoney(Math.max(0, load.rate - settled.received)),
        settled: settled.settled,
      },
    });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post("/:id/payment-reminder", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);

    const assignment = await activeAssignment(String(load._id));
    if (!assignment) {
      throw new AppError("Assign a driver and truck before sending a reminder", 400);
    }
    if (
      !FREIGHT_PAYMENT_STATUSES.has(load.loadStatus) &&
      load.loadStatus !== LoadStatus.PAYMENT_COMPLETED
    ) {
      throw new AppError(
        "Reminders are available after POD is received (payment step)",
        400
      );
    }

    const received = await freightReceivedTotal(scope.accountId, load._id);
    const outstanding = roundMoney(Math.max(0, load.rate - received));
    if (outstanding <= 0) {
      throw new AppError("Freight is already paid — no reminder needed", 400);
    }

    const billTo = load.source?.trim() || "customer/broker";
    const reminderEmail =
      (typeof req.body?.email === "string" && req.body.email.trim()) ||
      extractEmail(load.source) ||
      extractEmail(load.notes);

    const message = `Payment reminder for load ${load.loadNumber}: $${outstanding.toFixed(2)} outstanding (bill to ${billTo}).`;

    if (reminderEmail && isEmailConfigured()) {
      await sendMail({
        to: reminderEmail,
        subject: `Payment reminder · Load ${load.loadNumber}`,
        text: [
          message,
          "",
          `Load: ${load.loadNumber}`,
          `Route: ${load.pickupCity} → ${load.deliveryCity}`,
          `Rate: $${Number(load.rate).toFixed(2)}`,
          `Outstanding: $${outstanding.toFixed(2)}`,
        ].join("\n"),
        html: `<p>${message}</p><p><strong>Load:</strong> ${load.loadNumber}<br/><strong>Outstanding:</strong> $${outstanding.toFixed(2)}</p>`,
      });
    }

    await Notification.create({
      accountId: scope.accountId,
      userId: scope.userId,
      type: "FREIGHT_PAYMENT_REMINDER",
      message,
      link: `/loads/${load._id}`,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Load",
      entityId: String(load._id),
      action: "FREIGHT_PAYMENT_REMINDER",
      details: { outstanding, billTo, emailedTo: reminderEmail ?? null },
    });

    res.status(201).json({
      ok: true,
      message: reminderEmail && isEmailConfigured()
        ? `${message} Email sent to ${reminderEmail}.`
        : `${message} Saved as in-app notification.`,
      outstanding,
      emailedTo: reminderEmail && isEmailConfigured() ? reminderEmail : null,
    });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post("/:id/freight-invoice", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);
    const input = createFreightInvoiceSchema.parse(req.body ?? {});

    if (load.loadStatus === LoadStatus.CANCELLED) {
      throw new AppError("Cannot invoice a cancelled load", 400);
    }

    const assignment = await activeAssignment(String(load._id));
    if (!assignment) {
      throw new AppError("Assign a driver and truck before creating an invoice", 400);
    }
    if (
      !FREIGHT_PAYMENT_STATUSES.has(load.loadStatus) &&
      load.loadStatus !== LoadStatus.PAYMENT_COMPLETED
    ) {
      throw new AppError(
        "Freight invoices are available after POD is received (payment step)",
        400
      );
    }

    const existingItems = await InvoiceItem.find({ loadId: load._id }).lean();
    for (const item of existingItems) {
      const existing = await Invoice.findOne({
        _id: item.invoiceId,
        kind: InvoiceKind.FREIGHT,
        status: { $ne: InvoiceStatus.CANCELLED },
      }).lean();
      if (existing) {
        throw new AppError(
          `Freight invoice already exists: ${existing.invoiceNumber}`,
          409
        );
      }
    }

    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const billTo =
      input.billTo?.trim() ||
      load.source?.trim() ||
      `Load ${load.loadNumber} customer`;

    const billToEmail =
      input.billToEmail ||
      suggestedInvoiceRecipientEmail({
        billTo,
        notes: load.notes,
        driverEmail: null,
      });

    const invoice = await Invoice.create({
      accountId: scope.accountId,
      invoiceNumber: await nextFreightInvoiceNumber(String(scope.accountId)),
      kind: InvoiceKind.FREIGHT,
      driverId: null,
      billTo,
      billToEmail: billToEmail ?? null,
      createdByUserId: scope.userId,
      issueDate,
      dueDate,
      amount: roundMoney(load.rate),
      status: InvoiceStatus.DRAFT,
      notes: input.notes ?? `Freight for load ${load.loadNumber}`,
    });

    await InvoiceItem.create({
      invoiceId: invoice._id,
      loadId: load._id,
      description: `Freight · ${load.loadNumber} · ${load.pickupCity} → ${load.deliveryCity}`,
      amount: roundMoney(load.rate),
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Invoice",
      entityId: String(invoice._id),
      action: "FREIGHT_INVOICE_CREATED",
      details: { loadId: String(load._id), amount: load.rate, billTo },
    });

    res.status(201).json({ invoice: serializeInvoice(invoice.toObject()) });
  } catch (err) {
    next(err);
  }
});

loadsRouter.post(
  "/:id/documents",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        next(new AppError(err.message || "Upload failed", 400));
        return;
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const scope = getAccountScope(req.session!);
      const load = await getScopedLoad(scope, req.params.id);
      if (!req.file?.buffer) throw new AppError("File is required", 400);

      const meta = uploadMetaSchema.parse({
        docType: req.body.docType,
        expiryDate: req.body.expiryDate,
      });

      const ext = path.extname(req.file.originalname || "").toLowerCase();
      let mimeType = req.file.mimetype || null;
      if (
        (!mimeType || mimeType === "application/octet-stream") &&
        ext === ".pdf"
      ) {
        mimeType = "application/pdf";
      }

      const uploaded = await uploadDocumentToCloudinary({
        buffer: req.file.buffer,
        folder: `truckops/${scope.accountId}/loads/${load._id}`,
        fileName: req.file.originalname,
      });

      if (uploaded.format === "pdf" && (!mimeType || mimeType === "application/octet-stream")) {
        mimeType = "application/pdf";
      }

      const doc = await DocumentModel.create({
        accountId: scope.accountId,
        entityType: DocEntityType.LOAD,
        entityId: String(load._id),
        fileName: req.file.originalname,
        fileUrl: uploaded.url,
        storedPath: null,
        cloudinaryPublicId: uploaded.publicId,
        cloudinaryResourceType: uploaded.resourceType,
        mimeType,
        sizeBytes: uploaded.bytes || req.file.size,
        docType: meta.docType,
        expiryDate: meta.expiryDate,
        uploadedByUserId: scope.userId,
      });

      if (meta.docType === DocType.BOL && load.loadStatus === LoadStatus.AT_PICKUP) {
        // BOL unlocks advance to PICKED_UP; status stays explicit via status control
      }

      if (meta.docType === DocType.POD && load.loadStatus === LoadStatus.DELIVERED) {
        // POD unlocks advance to POD_RECEIVED; status stays explicit via status control
      }

      await logActivity({
        accountId: String(scope.accountId),
        userId: scope.userId,
        entityType: "Document",
        entityId: String(doc._id),
        action: "DOCUMENT_UPLOADED",
        details: {
          loadId: String(load._id),
          docType: meta.docType,
          fileName: doc.fileName,
          cloudinaryPublicId: uploaded.publicId,
        },
      });

      res.status(201).json({ document: serializeDocument(doc.toObject()) });
    } catch (err) {
      next(err);
    }
  }
);

loadsRouter.get("/:id/documents/file/:filename", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const load = await getScopedLoad(scope, req.params.id);
    const filename = path.basename(req.params.filename);

    const docs = await DocumentModel.find({
      ...tenantFilter(scope),
      entityType: DocEntityType.LOAD,
      entityId: String(load._id),
    }).lean();

    const doc = docs.find((d) => {
      if (d.storedPath && String(d.storedPath).endsWith(filename)) return true;
      if (d.cloudinaryPublicId && String(d.cloudinaryPublicId).endsWith(filename)) {
        return true;
      }
      if (d.fileUrl && String(d.fileUrl).includes(filename)) return true;
      return false;
    });

    if (!doc) throw new AppError("Document not found", 404);

    // Cloudinary (or any absolute URL) — redirect
    if (/^https?:\/\//i.test(doc.fileUrl)) {
      res.redirect(doc.fileUrl);
      return;
    }

    if (!doc.storedPath || !fs.existsSync(doc.storedPath)) {
      throw new AppError("File missing on server", 404);
    }

    const inline =
      req.query.inline === "1" ||
      req.query.view === "1" ||
      String(req.query.disposition || "").toLowerCase() === "inline";

    const mime = doc.mimeType || "application/octet-stream";
    if (inline) {
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(doc.fileName).replace(/"/g, "")}"`
      );
      res.sendFile(path.resolve(doc.storedPath));
      return;
    }

    res.download(doc.storedPath, doc.fileName);
  } catch (err) {
    next(err);
  }
});

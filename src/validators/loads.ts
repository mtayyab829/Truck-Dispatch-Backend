import { z } from "zod";
import { CommissionType, LoadStatus, DocType, PaymentMethod } from "../models/enums.js";

const optionalDate = z
  .union([z.string(), z.date(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
    return d;
  });

const requiredDate = z.union([z.string(), z.date()]).transform((v) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
});

const optionalString = z
  .union([z.string(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    return v.trim();
  });

const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error("Invalid number");
    return n;
  });

const requiredNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error("Invalid number");
  return n;
});

export const createLoadSchema = z.object({
  loadNumber: optionalString,
  source: optionalString,
  pickupCity: z.string().trim().min(1),
  pickupState: optionalString,
  pickupDateTime: requiredDate,
  deliveryCity: z.string().trim().min(1),
  deliveryState: optionalString,
  deliveryDateTime: requiredDate,
  equipment: optionalString,
  commodity: optionalString,
  weight: optionalNumber,
  miles: optionalNumber,
  rate: requiredNumber,
  commissionType: z
    .enum([CommissionType.PERCENTAGE, CommissionType.FIXED])
    .default(CommissionType.PERCENTAGE),
  commissionValue: requiredNumber,
  notes: optionalString,
  driverId: optionalString,
  truckId: optionalString,
});

export const updateLoadSchema = createLoadSchema.partial().omit({
  driverId: true,
  truckId: true,
});

export const assignLoadSchema = z.object({
  driverId: z.string().min(1),
  truckId: z.string().min(1),
});

export const changeStatusSchema = z.object({
  status: z.enum([
    LoadStatus.CREATED,
    LoadStatus.ASSIGNED,
    LoadStatus.AT_PICKUP,
    LoadStatus.PICKED_UP,
    LoadStatus.IN_TRANSIT,
    LoadStatus.AT_DELIVERY,
    LoadStatus.DELIVERED,
    LoadStatus.POD_RECEIVED,
    LoadStatus.PAYMENT_FOLLOW_UP,
    LoadStatus.PAYMENT_COMPLETED,
    LoadStatus.CANCELLED,
  ]),
  note: optionalString,
});

export const recordCommissionPaymentSchema = z.object({
  loadId: z.string().min(1),
  amount: requiredNumber,
  date: requiredDate,
  method: z
    .enum([
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.CASH,
      PaymentMethod.CHECK,
      PaymentMethod.OTHER,
    ])
    .default(PaymentMethod.OTHER),
  reference: optionalString,
  notes: optionalString,
});

export const uploadMetaSchema = z.object({
  docType: z
    .enum([
      DocType.RATE_CONFIRMATION,
      DocType.BOL,
      DocType.POD,
      DocType.CDL,
      DocType.INSURANCE,
      DocType.AGREEMENT,
      DocType.INSPECTION,
      DocType.REGISTRATION,
      DocType.OTHER,
    ])
    .default(DocType.OTHER),
  expiryDate: optionalDate,
});

import { z } from "zod";
import {
  Direction,
  ExpenseCategory,
  InvoiceStatus,
  PaymentMethod,
  TransactionType,
} from "../models/enums.js";

const optionalString = z
  .union([z.string(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    return v.trim();
  });

const requiredDate = z.union([z.string(), z.date()]).transform((v) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
});

const requiredNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error("Invalid number");
  return n;
});

const optionalObjectId = optionalString;

const paymentMethod = z.enum([
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CASH,
  PaymentMethod.CHECK,
  PaymentMethod.OTHER,
]);

export const createPaymentSchema = z.object({
  type: z.enum([
    TransactionType.DRIVER_PAYMENT,
    TransactionType.COMMISSION_RECEIVED,
    TransactionType.FREIGHT_RECEIVED,
    TransactionType.ADVANCE,
    TransactionType.ADJUSTMENT,
  ]),
  direction: z.enum([Direction.IN, Direction.OUT]).optional(),
  amount: requiredNumber,
  date: requiredDate,
  method: paymentMethod.default(PaymentMethod.OTHER),
  loadId: optionalObjectId,
  driverId: optionalObjectId,
  reference: optionalString,
  notes: optionalString,
  /** When recording commission against an invoice */
  invoiceId: optionalObjectId,
});

export const createExpenseSchema = z.object({
  category: z.enum([
    ExpenseCategory.FUEL,
    ExpenseCategory.TOLLS,
    ExpenseCategory.REPAIRS,
    ExpenseCategory.PERMITS,
    ExpenseCategory.PHONE,
    ExpenseCategory.OFFICE,
    ExpenseCategory.OTHER,
  ]),
  amount: requiredNumber,
  date: requiredDate,
  loadId: optionalObjectId,
  driverId: optionalObjectId,
  truckId: optionalObjectId,
  notes: optionalString,
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const createInvoiceSchema = z.object({
  driverId: z.string().min(1),
  loadIds: z.array(z.string().min(1)).min(1),
  issueDate: requiredDate,
  dueDate: requiredDate,
  notes: optionalString,
  invoiceNumber: optionalString,
});

export const invoicePaymentSchema = z.object({
  amount: requiredNumber,
  date: requiredDate,
  method: paymentMethod.default(PaymentMethod.OTHER),
  reference: optionalString,
  notes: optionalString,
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum([
    InvoiceStatus.DRAFT,
    InvoiceStatus.SENT,
    InvoiceStatus.DUE,
    InvoiceStatus.PAID,
    InvoiceStatus.OVERDUE,
    InvoiceStatus.CANCELLED,
  ]),
});

export const sendInvoiceSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  message: optionalString,
});

export const recordFreightPaymentSchema = z.object({
  amount: requiredNumber,
  date: requiredDate,
  method: paymentMethod.default(PaymentMethod.OTHER),
  reference: optionalString,
  notes: optionalString,
});

export const createFreightInvoiceSchema = z.object({
  billTo: optionalString,
  billToEmail: z
    .union([z.string().trim().email("Enter a valid email"), z.literal("")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  notes: optionalString,
});

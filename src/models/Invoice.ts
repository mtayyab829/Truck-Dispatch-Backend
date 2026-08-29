import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { InvoiceKind, InvoiceStatus } from "./enums.js";

const invoiceSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    invoiceNumber: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: Object.values(InvoiceKind),
      default: InvoiceKind.COMMISSION,
      index: true,
    },
    /** Required for commission invoices; null for freight (broker/customer) */
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },
    /** Broker / customer name for freight invoices */
    billTo: { type: String, default: null, trim: true },
    /** Broker / customer email for freight invoice delivery */
    billToEmail: { type: String, default: null, trim: true, lowercase: true },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(InvoiceStatus),
      default: InvoiceStatus.DRAFT,
      index: true,
    },
    notes: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

invoiceSchema.index({ accountId: 1, invoiceNumber: 1 }, { unique: true });

export type InvoiceDocument = InferSchemaType<typeof invoiceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Invoice: Model<InvoiceDocument> =
  mongoose.models.Invoice ?? mongoose.model("Invoice", invoiceSchema);

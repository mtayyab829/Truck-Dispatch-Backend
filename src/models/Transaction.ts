import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { Direction, PaymentMethod, TransactionType } from "./enums.js";

/** Unified money ledger — every $ traces to load/driver when applicable */
const transactionSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    loadId: {
      type: Schema.Types.ObjectId,
      ref: "Load",
      default: null,
      index: true,
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
    },
    direction: {
      type: String,
      enum: Object.values(Direction),
      required: true,
    },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    method: {
      type: String,
      enum: Object.values(PaymentMethod),
      default: PaymentMethod.OTHER,
    },
    reference: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

transactionSchema.index({ accountId: 1, type: 1, date: -1 });

export type TransactionDocument = InferSchemaType<typeof transactionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Transaction: Model<TransactionDocument> =
  mongoose.models.Transaction ?? mongoose.model("Transaction", transactionSchema);

import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { ExpenseCategory } from "./enums.js";

const expenseSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(ExpenseCategory),
      required: true,
    },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    loadId: { type: Schema.Types.ObjectId, ref: "Load", default: null },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

expenseSchema.index({ accountId: 1, date: -1 });

export type ExpenseDocument = InferSchemaType<typeof expenseSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Expense: Model<ExpenseDocument> =
  mongoose.models.Expense ?? mongoose.model("Expense", expenseSchema);

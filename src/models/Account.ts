import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { AccountType, CommissionType } from "./enums.js";

const accountSchema = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(AccountType),
      required: true,
    },
    name: { type: String, required: true, trim: true },
    currency: { type: String, default: "USD" },
    defaultCommissionType: {
      type: String,
      enum: Object.values(CommissionType),
      default: CommissionType.PERCENTAGE,
    },
    defaultCommissionValue: { type: Number, default: 5 },
    settings: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export type AccountDocument = InferSchemaType<typeof accountSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Account: Model<AccountDocument> =
  mongoose.models.Account ?? mongoose.model("Account", accountSchema);

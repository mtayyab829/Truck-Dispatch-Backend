import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { CommissionType, LoadStatus } from "./enums.js";

const loadSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    loadNumber: { type: String, required: true, trim: true },
    source: { type: String, default: null, trim: true },
    pickupCity: { type: String, required: true, trim: true },
    pickupState: { type: String, default: null, trim: true },
    pickupDateTime: { type: Date, required: true },
    deliveryCity: { type: String, required: true, trim: true },
    deliveryState: { type: String, default: null, trim: true },
    deliveryDateTime: { type: Date, required: true },
    equipment: { type: String, default: null, trim: true },
    commodity: { type: String, default: null, trim: true },
    weight: { type: Number, default: null },
    miles: { type: Number, default: null },
    rate: { type: Number, required: true },
    commissionType: {
      type: String,
      enum: Object.values(CommissionType),
      default: CommissionType.PERCENTAGE,
    },
    commissionValue: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    /** Set when first COMMISSION_RECEIVED settles this load's commission fully */
    commissionSettled: { type: Boolean, default: false },
    /** Set when FREIGHT_RECEIVED payments cover the load rate */
    rateSettled: { type: Boolean, default: false },
    loadStatus: {
      type: String,
      enum: Object.values(LoadStatus),
      default: LoadStatus.CREATED,
      index: true,
    },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

loadSchema.index({ accountId: 1, loadNumber: 1 }, { unique: true });
loadSchema.index({ accountId: 1, loadStatus: 1 });

export type LoadDocument = InferSchemaType<typeof loadSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Load: Model<LoadDocument> =
  mongoose.models.Load ?? mongoose.model("Load", loadSchema);

import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { TruckStatus } from "./enums.js";

const truckSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    unitNumber: { type: String, required: true, trim: true },
    plate: { type: String, default: null, trim: true },
    vin: { type: String, default: null, trim: true },
    make: { type: String, default: null, trim: true },
    model: { type: String, default: null, trim: true },
    year: { type: Number, default: null },
    type: { type: String, default: null, trim: true },
    /** Owner name/company — may differ from the operating driver */
    owner: { type: String, default: null, trim: true },
    insuranceExpiry: { type: Date, default: null },
    inspectionExpiry: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(TruckStatus),
      default: TruckStatus.ACTIVE,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

truckSchema.index({ accountId: 1, unitNumber: 1 }, { unique: true });

export type TruckDocument = InferSchemaType<typeof truckSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Truck: Model<TruckDocument> =
  mongoose.models.Truck ?? mongoose.model("Truck", truckSchema);

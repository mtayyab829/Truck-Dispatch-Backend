import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const driverSchema = new Schema(
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
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    cdlNumber: { type: String, default: null, trim: true },
    licenseExpiry: { type: Date, default: null },
    insuranceExpiry: { type: Date, default: null },
    /** Truck owner name/company — may differ from the driver */
    ownerCompany: { type: String, default: null, trim: true },
    notes: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

driverSchema.index({ accountId: 1, name: 1 });

export type DriverDocument = InferSchemaType<typeof driverSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Driver: Model<DriverDocument> =
  mongoose.models.Driver ?? mongoose.model("Driver", driverSchema);

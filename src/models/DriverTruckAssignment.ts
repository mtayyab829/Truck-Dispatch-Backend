import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** Dated M:N history between drivers and trucks */
const driverTruckAssignmentSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    truckId: {
      type: Schema.Types.ObjectId,
      ref: "Truck",
      required: true,
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

driverTruckAssignmentSchema.index({ accountId: 1, driverId: 1, endDate: 1 });
driverTruckAssignmentSchema.index({ accountId: 1, truckId: 1, endDate: 1 });

export type DriverTruckAssignmentDocument = InferSchemaType<
  typeof driverTruckAssignmentSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const DriverTruckAssignment: Model<DriverTruckAssignmentDocument> =
  mongoose.models.DriverTruckAssignment ??
  mongoose.model("DriverTruckAssignment", driverTruckAssignmentSchema);

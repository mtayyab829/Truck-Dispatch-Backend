import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const userAssignmentSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

userAssignmentSchema.index({ accountId: 1, userId: 1, endDate: 1 });

export type UserAssignmentDocument = InferSchemaType<typeof userAssignmentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const UserAssignment: Model<UserAssignmentDocument> =
  mongoose.models.UserAssignment ??
  mongoose.model("UserAssignment", userAssignmentSchema);

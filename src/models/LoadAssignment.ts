import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const loadAssignmentSchema = new Schema(
  {
    loadId: {
      type: Schema.Types.ObjectId,
      ref: "Load",
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
    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type LoadAssignmentDocument = InferSchemaType<typeof loadAssignmentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const LoadAssignment: Model<LoadAssignmentDocument> =
  mongoose.models.LoadAssignment ??
  mongoose.model("LoadAssignment", loadAssignmentSchema);

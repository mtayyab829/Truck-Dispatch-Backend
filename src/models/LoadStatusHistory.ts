import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { LoadStatus } from "./enums.js";

const loadStatusHistorySchema = new Schema(
  {
    loadId: {
      type: Schema.Types.ObjectId,
      ref: "Load",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(LoadStatus),
      required: true,
    },
    changedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changedAt: { type: Date, default: Date.now },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type LoadStatusHistoryDocument = InferSchemaType<
  typeof loadStatusHistorySchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const LoadStatusHistory: Model<LoadStatusHistoryDocument> =
  mongoose.models.LoadStatusHistory ??
  mongoose.model("LoadStatusHistory", loadStatusHistorySchema);

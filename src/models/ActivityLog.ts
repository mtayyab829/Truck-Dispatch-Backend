import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** Append-only audit log — never update or delete entries in application code */
const activityLogSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function () {
  throw new Error("ActivityLog is append-only and cannot be updated");
});

activityLogSchema.pre(["findOneAndDelete", "deleteOne", "deleteMany"], function () {
  throw new Error("ActivityLog is append-only and cannot be deleted");
});

export type ActivityLogDocument = InferSchemaType<typeof activityLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ActivityLog: Model<ActivityLogDocument> =
  mongoose.models.ActivityLog ?? mongoose.model("ActivityLog", activityLogSchema);

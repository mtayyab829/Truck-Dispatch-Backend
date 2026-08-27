import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DocEntityType, DocType } from "./enums.js";

const documentSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: Object.values(DocEntityType),
      required: true,
    },
    entityId: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    /** Public URL (Cloudinary secure_url, or legacy /api/... path) */
    fileUrl: { type: String, required: true },
    /** Legacy local disk path — optional when using Cloudinary */
    storedPath: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },
    cloudinaryResourceType: { type: String, default: null },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    docType: {
      type: String,
      enum: Object.values(DocType),
      default: DocType.OTHER,
    },
    expiryDate: { type: Date, default: null },
    uploadedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

documentSchema.index({ accountId: 1, entityType: 1, entityId: 1 });

export type DocumentRecord = InferSchemaType<typeof documentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const DocumentModel: Model<DocumentRecord> =
  mongoose.models.Document ?? mongoose.model("Document", documentSchema);

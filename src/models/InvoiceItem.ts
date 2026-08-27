import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const invoiceItemSchema = new Schema(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    loadId: {
      type: Schema.Types.ObjectId,
      ref: "Load",
      required: true,
      index: true,
    },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type InvoiceItemDocument = InferSchemaType<typeof invoiceItemSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InvoiceItem: Model<InvoiceItemDocument> =
  mongoose.models.InvoiceItem ?? mongoose.model("InvoiceItem", invoiceItemSchema);

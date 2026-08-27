import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const invoicePaymentSchema = new Schema(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type InvoicePaymentDocument = InferSchemaType<typeof invoicePaymentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InvoicePayment: Model<InvoicePaymentDocument> =
  mongoose.models.InvoicePayment ??
  mongoose.model("InvoicePayment", invoicePaymentSchema);

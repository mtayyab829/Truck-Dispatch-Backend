import { InvoiceStatus } from "../models/enums.js";
import { roundMoney } from "./commission.js";

/** Derive display/storage status from dates + amount paid */
export function deriveInvoiceStatus(input: {
  status: string;
  dueDate: Date;
  amount: number;
  paidTotal: number;
  today?: Date;
}): string {
  if (
    input.status === InvoiceStatus.CANCELLED ||
    input.status === InvoiceStatus.DRAFT
  ) {
    return input.status;
  }

  if (input.paidTotal + 0.001 >= input.amount) {
    return InvoiceStatus.PAID;
  }

  const today = input.today ?? new Date();
  const due = new Date(input.dueDate);
  due.setHours(23, 59, 59, 999);

  if (due < today) {
    return InvoiceStatus.OVERDUE;
  }

  if (input.status === InvoiceStatus.SENT) {
    return InvoiceStatus.SENT;
  }

  if (input.status === InvoiceStatus.DUE || input.status === InvoiceStatus.OVERDUE) {
    return InvoiceStatus.DUE;
  }

  return input.status;
}

export function agingBucket(dueDate: Date, today = new Date()): string {
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const days = Math.floor((t.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function sumAmounts(amounts: number[]): number {
  return roundMoney(amounts.reduce((a, b) => a + b, 0));
}

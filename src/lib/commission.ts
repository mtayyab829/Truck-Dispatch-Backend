import { CommissionType } from "../models/enums.js";

/** Round money to 2 decimal places (half-up). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Commission snapshot:
 * PERCENTAGE → rate × value / 100
 * FIXED → value
 */
export function calculateCommissionAmount(
  rate: number,
  commissionType: CommissionType | string,
  commissionValue: number
): number {
  if (commissionType === CommissionType.FIXED) {
    return roundMoney(commissionValue);
  }
  return roundMoney((rate * commissionValue) / 100);
}

export const EARNED_STATUSES = new Set([
  "DELIVERED",
  "POD_RECEIVED",
  "PAYMENT_FOLLOW_UP",
  "PAYMENT_COMPLETED",
]);

export function isCommissionEarned(loadStatus: string): boolean {
  return EARNED_STATUSES.has(loadStatus);
}

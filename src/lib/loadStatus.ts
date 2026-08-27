import { LoadStatus } from "../models/enums.js";

export const FLOW: string[] = [
  LoadStatus.CREATED,
  LoadStatus.ASSIGNED,
  LoadStatus.AT_PICKUP,
  LoadStatus.PICKED_UP,
  LoadStatus.IN_TRANSIT,
  LoadStatus.AT_DELIVERY,
  LoadStatus.DELIVERED,
  LoadStatus.POD_RECEIVED,
  LoadStatus.PAYMENT_COMPLETED,
];

const POST_DELIVERY: Set<string> = new Set([
  LoadStatus.DELIVERED,
  LoadStatus.POD_RECEIVED,
  LoadStatus.PAYMENT_FOLLOW_UP, // legacy
  LoadStatus.PAYMENT_COMPLETED,
]);

/** Statuses where freight payment can be recorded */
export const FREIGHT_PAYMENT_STATUSES: Set<string> = new Set([
  LoadStatus.POD_RECEIVED,
  LoadStatus.PAYMENT_FOLLOW_UP, // legacy
]);

/**
 * Allow forward moves along the main flow, or CANCELLED from any
 * pre-delivery status.
 */
export function canTransition(from: string, to: string): boolean {
  if (from === to) return false;
  if (from === LoadStatus.CANCELLED || from === LoadStatus.PAYMENT_COMPLETED) {
    return false;
  }
  if (to === LoadStatus.CANCELLED) {
    return !POST_DELIVERY.has(from);
  }
  // Legacy loads stuck on removed follow-up step
  if (
    from === LoadStatus.PAYMENT_FOLLOW_UP &&
    to === LoadStatus.PAYMENT_COMPLETED
  ) {
    return true;
  }
  const fromIdx = FLOW.indexOf(from);
  const toIdx = FLOW.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx === fromIdx + 1; // one step forward
}

export function nextStatuses(from: string): string[] {
  if (from === LoadStatus.CANCELLED || from === LoadStatus.PAYMENT_COMPLETED) {
    return [];
  }
  // CREATED → use /assign to reach ASSIGNED; only cancel from status control
  if (from === LoadStatus.CREATED) return [LoadStatus.CANCELLED];
  if (from === LoadStatus.PAYMENT_FOLLOW_UP) {
    return [LoadStatus.PAYMENT_COMPLETED];
  }
  const fromIdx = FLOW.indexOf(from);
  const options: string[] = [];
  if (fromIdx >= 0 && fromIdx < FLOW.length - 1) {
    options.push(FLOW[fromIdx + 1]!);
  }
  if (!POST_DELIVERY.has(from)) {
    options.push(LoadStatus.CANCELLED);
  }
  return options;
}

export function flowIndexOf(status: string): number {
  if (status === LoadStatus.PAYMENT_FOLLOW_UP) {
    return FLOW.indexOf(LoadStatus.POD_RECEIVED);
  }
  return FLOW.indexOf(status);
}

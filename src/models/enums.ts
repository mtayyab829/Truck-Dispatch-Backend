/** Shared enums matching the product data model */

export const AccountType = {
  INDIVIDUAL: "INDIVIDUAL",
  COMPANY: "COMPANY",
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const UserRole = {
  ADMIN: "ADMIN",
  DISPATCHER: "DISPATCHER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const CommissionType = {
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
} as const;
export type CommissionType = (typeof CommissionType)[keyof typeof CommissionType];

export const LoadStatus = {
  CREATED: "CREATED",
  ASSIGNED: "ASSIGNED",
  AT_PICKUP: "AT_PICKUP",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  AT_DELIVERY: "AT_DELIVERY",
  DELIVERED: "DELIVERED",
  POD_RECEIVED: "POD_RECEIVED",
  PAYMENT_FOLLOW_UP: "PAYMENT_FOLLOW_UP",
  PAYMENT_COMPLETED: "PAYMENT_COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus];

export const PaymentMethod = {
  BANK_TRANSFER: "BANK_TRANSFER",
  CASH: "CASH",
  CHECK: "CHECK",
  OTHER: "OTHER",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const TransactionType = {
  DRIVER_PAYMENT: "DRIVER_PAYMENT",
  COMMISSION_RECEIVED: "COMMISSION_RECEIVED",
  FREIGHT_RECEIVED: "FREIGHT_RECEIVED",
  ADVANCE: "ADVANCE",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const Direction = {
  IN: "IN",
  OUT: "OUT",
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const InvoiceStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  DUE: "DUE",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const InvoiceKind = {
  COMMISSION: "COMMISSION",
  FREIGHT: "FREIGHT",
} as const;
export type InvoiceKind = (typeof InvoiceKind)[keyof typeof InvoiceKind];

export const DocEntityType = {
  LOAD: "LOAD",
  DRIVER: "DRIVER",
  TRUCK: "TRUCK",
} as const;
export type DocEntityType = (typeof DocEntityType)[keyof typeof DocEntityType];

export const DocType = {
  RATE_CONFIRMATION: "RATE_CONFIRMATION",
  BOL: "BOL",
  POD: "POD",
  CDL: "CDL",
  INSURANCE: "INSURANCE",
  AGREEMENT: "AGREEMENT",
  INSPECTION: "INSPECTION",
  REGISTRATION: "REGISTRATION",
  OTHER: "OTHER",
} as const;
export type DocType = (typeof DocType)[keyof typeof DocType];

export const ExpenseCategory = {
  FUEL: "FUEL",
  TOLLS: "TOLLS",
  REPAIRS: "REPAIRS",
  PERMITS: "PERMITS",
  PHONE: "PHONE",
  OFFICE: "OFFICE",
  OTHER: "OTHER",
} as const;
export type ExpenseCategory = (typeof ExpenseCategory)[keyof typeof ExpenseCategory];

export const TruckStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  IN_REPAIR: "IN_REPAIR",
} as const;
export type TruckStatus = (typeof TruckStatus)[keyof typeof TruckStatus];

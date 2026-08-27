import { z } from "zod";
import { TruckStatus } from "../models/enums.js";

const optionalDate = z
  .union([z.string(), z.date(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

const optionalString = z
  .union([z.string(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    return v.trim();
  });

export const driverFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optionalString,
  email: z
    .union([z.string().email(), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v.toLowerCase())),
  cdlNumber: optionalString,
  licenseExpiry: optionalDate,
  insuranceExpiry: optionalDate,
  ownerCompany: optionalString,
  notes: optionalString,
  isActive: z.boolean().optional(),
});

export const truckFieldsSchema = z.object({
  unitNumber: z.string().trim().min(1).max(40),
  plate: optionalString,
  vin: optionalString,
  make: optionalString,
  model: optionalString,
  year: z
    .union([z.number(), z.string(), z.null(), z.literal("")])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  type: optionalString,
  owner: optionalString,
  insuranceExpiry: optionalDate,
  inspectionExpiry: optionalDate,
  status: z.enum([TruckStatus.ACTIVE, TruckStatus.INACTIVE, TruckStatus.IN_REPAIR]).optional(),
  isActive: z.boolean().optional(),
});

export const createDriverSchema = driverFieldsSchema;
export const updateDriverSchema = driverFieldsSchema.partial();

export const createTruckSchema = truckFieldsSchema;
export const updateTruckSchema = truckFieldsSchema.partial();

/** Guided flow: driver + truck + assignment in one request */
export const createDriverWithTruckSchema = z.object({
  driver: driverFieldsSchema,
  truck: truckFieldsSchema,
  assignmentStartDate: optionalDate.transform((v) => v ?? new Date()),
});

export const linkDriverTruckSchema = z.object({
  driverId: z.string().min(1),
  truckId: z.string().min(1),
  startDate: optionalDate.transform((v) => v ?? new Date()),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type CreateTruckInput = z.infer<typeof createTruckSchema>;
export type CreateDriverWithTruckInput = z.infer<typeof createDriverWithTruckSchema>;

import { z } from "zod";
import { AccountType } from "../models/enums.js";

export const registerSchema = z.object({
  accountType: z.enum([AccountType.INDIVIDUAL, AccountType.COMPANY]),
  accountName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

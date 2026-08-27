import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  GMAIL_USER: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Google App Password (not your normal Gmail password) */
  GMAIL_APP_PASSWORD: z
    .union([z.string().min(8), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  CLOUDINARY_CLOUD_NAME: z
    .union([z.string().min(1), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  CLOUDINARY_API_KEY: z
    .union([z.string().min(1), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  CLOUDINARY_API_SECRET: z
    .union([z.string().min(1), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET
  );
}

function ensureConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new AppError(
      "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to backend/.env",
      503
    );
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
}

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  resourceType: string;
  bytes: number;
  format: string | null;
};

/** Upload a document buffer (PDF, image, Word) to Cloudinary. */
export async function uploadDocumentToCloudinary(input: {
  buffer: Buffer;
  folder: string;
  fileName: string;
}): Promise<CloudinaryUploadResult> {
  ensureConfigured();

  const safeBase = input.fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: input.folder,
        resource_type: "auto",
        public_id: `${Date.now()}-${safeBase || "document"}`,
        overwrite: false,
      },
      (err, result) => {
        if (err || !result) {
          reject(
            err instanceof Error
              ? err
              : new AppError("Cloudinary upload failed", 502)
          );
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
          bytes: result.bytes ?? input.buffer.length,
          format: result.format ?? null,
        });
      }
    );
    stream.end(input.buffer);
  });
}

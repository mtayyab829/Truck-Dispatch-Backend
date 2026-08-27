import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

export function isEmailConfigured(): boolean {
  return Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new AppError(
      "Gmail is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in backend .env (use a Google App Password).",
      503
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"TruckOps" <${env.GMAIL_USER}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

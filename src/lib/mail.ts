import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

export type EmailProvider = "resend" | "gmail" | "none";

/** Resend uses HTTPS (port 443) and works on Render free tier; Gmail SMTP is blocked there. */
export function getEmailProvider(): EmailProvider {
  if (env.RESEND_API_KEY) return "resend";
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return "gmail";
  return "none";
}

export function isEmailConfigured(): boolean {
  return getEmailProvider() !== "none";
}

function defaultFromAddress(): string {
  if (env.RESEND_FROM) return env.RESEND_FROM;
  if (env.GMAIL_USER) return `"TruckOps" <${env.GMAIL_USER}>`;
  return "TruckOps <onboarding@resend.dev>";
}

function formatSmtpError(err: unknown): AppError {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: string }).code)
      : "";

  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET") {
    return new AppError(
      "Gmail SMTP timed out. Render free tier blocks SMTP ports 465/587. Add RESEND_API_KEY in Render (free at resend.com — verify your sender email) or upgrade Render to a paid plan.",
      503
    );
  }

  if (code === "EAUTH") {
    return new AppError(
      "Gmail rejected the login. Use a Google App Password (not your normal password) and remove spaces from GMAIL_APP_PASSWORD.",
      502
    );
  }

  const msg = err instanceof Error ? err.message : "Email send failed";
  return new AppError(msg, 502);
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new AppError("Resend is not configured", 503);
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: defaultFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    let message = `Email send failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new AppError(message, 502);
  }
}

async function sendViaGmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new AppError(
      "Gmail is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD, or use RESEND_API_KEY on Render.",
      503
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: defaultFromAddress(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } catch (err) {
    throw formatSmtpError(err);
  }
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const provider = getEmailProvider();
  if (provider === "none") {
    throw new AppError(
      "Email is not configured. On Render, set RESEND_API_KEY (recommended). Locally you can use GMAIL_USER + GMAIL_APP_PASSWORD.",
      503
    );
  }

  if (provider === "resend") {
    await sendViaResend(input);
    return;
  }

  await sendViaGmail(input);
}

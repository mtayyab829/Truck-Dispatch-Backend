import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { AccountType, UserRole } from "../models/enums.js";
import type { AccountScope } from "./scope.js";
import { sendMail, isEmailConfigured } from "./mail.js";

export type AdminNotifyInput = {
  type: string;
  message: string;
  link?: string | null;
  email?: {
    subject: string;
    text: string;
    html?: string;
  };
};

type Actor = { userId: string; name: string };

/** In-app alert for company admin(s) when a dispatcher performs an action. Email is optional. */
export async function notifyCompanyAdmin(
  scope: AccountScope,
  actor: Actor,
  input: AdminNotifyInput
): Promise<void> {
  try {
    if (scope.accountType !== AccountType.COMPANY) return;
    if (scope.role !== UserRole.DISPATCHER) return;

    const admins = await User.find({
      accountId: scope.accountId,
      role: UserRole.ADMIN,
      isActive: true,
    }).lean();

    if (admins.length === 0) return;

    for (const admin of admins) {
      if (String(admin._id) === actor.userId) continue;

      await Notification.create({
        accountId: scope.accountId,
        userId: admin._id,
        type: input.type,
        message: input.message,
        link: input.link ?? null,
      });

      if (input.email && isEmailConfigured()) {
        try {
          await sendMail({
            to: admin.email,
            subject: input.email.subject,
            text: input.email.text,
            html: input.email.html ?? textToHtml(input.email.text),
          });
        } catch (err) {
          console.error("Admin notification email failed:", err);
        }
      }
    }
  } catch (err) {
    console.error("notifyCompanyAdmin failed:", err);
  }
}

function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => `<p style="margin:0 0 8px;color:#334155;">${escapeHtml(line)}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLoadCreatedNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  route: string;
  rate: number;
}): AdminNotifyInput {
  const message = `${input.actorName} created load ${input.loadNumber} (${input.route}) · ${formatMoney(input.rate)}`;
  const text = [
    `${input.actorName} created a new load.`,
    "",
    `Load: ${input.loadNumber}`,
    `Route: ${input.route}`,
    `Rate: ${formatMoney(input.rate)}`,
    "",
    "Open TruckOps to review.",
  ].join("\n");

  return {
    type: "DISPATCHER_LOAD_CREATED",
    message,
    link: `/loads/${input.loadId}`,
    email: {
      subject: `New load ${input.loadNumber}`,
      text,
      html: wrapEmail("New load created", text),
    },
  };
}

export function buildDocumentUploadedNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  docType: string;
  fileName: string;
}): AdminNotifyInput {
  const docLabel = input.docType.replace(/_/g, " ");
  return {
    type: "DISPATCHER_DOCUMENT_UPLOADED",
    message: `${input.actorName} uploaded ${docLabel} (${input.fileName}) on load ${input.loadNumber}`,
    link: `/loads/${input.loadId}`,
  };
}

export function buildPaymentRecordedNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  paymentKind: "freight" | "commission";
  amount: number;
  method: string;
}): AdminNotifyInput {
  const kind = input.paymentKind === "freight" ? "Freight" : "Commission";
  const methodLabel = input.method.replace(/_/g, " ");
  const message = `${input.actorName} recorded ${kind.toLowerCase()} payment of ${formatMoney(input.amount)} on load ${input.loadNumber}`;
  const text = [
    `${input.actorName} recorded a ${kind.toLowerCase()} payment.`,
    "",
    `Load: ${input.loadNumber}`,
    `Amount: ${formatMoney(input.amount)}`,
    `Method: ${methodLabel}`,
    "",
    "Open TruckOps to review.",
  ].join("\n");

  return {
    type: "DISPATCHER_PAYMENT_RECORDED",
    message,
    link: `/loads/${input.loadId}`,
    email: {
      subject: `${kind} payment · ${input.loadNumber}`,
      text,
      html: wrapEmail(`${kind} payment recorded`, text),
    },
  };
}

export function buildLoadAssignedNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  driverName: string;
}): AdminNotifyInput {
  return {
    type: "DISPATCHER_LOAD_ASSIGNED",
    message: `${input.actorName} assigned ${input.driverName} to load ${input.loadNumber}`,
    link: `/loads/${input.loadId}`,
  };
}

export function buildLoadStatusNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  statusLabel: string;
}): AdminNotifyInput {
  return {
    type: "DISPATCHER_LOAD_STATUS",
    message: `${input.actorName} updated load ${input.loadNumber} to ${input.statusLabel}`,
    link: `/loads/${input.loadId}`,
  };
}

export function buildFreightInvoiceNotify(input: {
  actorName: string;
  loadNumber: string;
  loadId: string;
  invoiceNumber: string;
  invoiceId: string;
}): AdminNotifyInput {
  return {
    type: "DISPATCHER_FREIGHT_INVOICE",
    message: `${input.actorName} created freight invoice ${input.invoiceNumber} for load ${input.loadNumber}`,
    link: `/invoices/${input.invoiceId}`,
  };
}

function formatMoney(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

function wrapEmail(title: string, text: string): string {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <p style="letter-spacing:0.15em;text-transform:uppercase;color:#d97706;font-size:11px;">TruckOps</p>
      <h1 style="margin:8px 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
      ${textToHtml(text)}
    </div>
  `;
}

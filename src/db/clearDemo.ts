import mongoose from "mongoose";
import { Account } from "../models/Account.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { LoadStatusHistory } from "../models/LoadStatusHistory.js";
import { DocumentModel } from "../models/Document.js";
import { Transaction } from "../models/Transaction.js";
import { Expense } from "../models/Expense.js";
import { Invoice } from "../models/Invoice.js";
import { InvoiceItem } from "../models/InvoiceItem.js";
import { InvoicePayment } from "../models/InvoicePayment.js";
import { Notification } from "../models/Notification.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { UserAssignment } from "../models/UserAssignment.js";
import { DriverTruckAssignment } from "../models/DriverTruckAssignment.js";

const DEMO_EMAILS = [
  "owner@demo.com",
  "admin@demo.com",
  "dispatcher@demo.com",
];

const DEMO_ACCOUNT_NAMES = [
  "Demo Individual Dispatch",
  "Demo Fleet Company",
];

/** Remove seeded demo accounts and all related tenant data. */
export async function clearDemoData(): Promise<{
  accountIds: string[];
  deletedUsers: number;
}> {
  const users = await User.find({ email: { $in: DEMO_EMAILS } }).lean();
  const accountsByName = await Account.find({
    name: { $in: DEMO_ACCOUNT_NAMES },
  }).lean();

  const accountIdSet = new Set<string>([
    ...users.map((u) => String(u.accountId)),
    ...accountsByName.map((a) => String(a._id)),
  ]);

  const accountIds = [...accountIdSet];
  if (accountIds.length === 0) {
    return { accountIds: [], deletedUsers: 0 };
  }

  const objectIds = accountIds.map((id) => new mongoose.Types.ObjectId(id));
  const loads = await Load.find({ accountId: { $in: objectIds } })
    .select("_id")
    .lean();
  const loadIds = loads.map((l) => l._id);

  const invoices = await Invoice.find({ accountId: { $in: objectIds } })
    .select("_id")
    .lean();
  const invoiceIds = invoices.map((i) => i._id);

  if (loadIds.length > 0) {
    await LoadAssignment.deleteMany({ loadId: { $in: loadIds } });
    await LoadStatusHistory.deleteMany({ loadId: { $in: loadIds } });
  }
  if (invoiceIds.length > 0) {
    await InvoiceItem.deleteMany({ invoiceId: { $in: invoiceIds } });
    await InvoicePayment.deleteMany({ invoiceId: { $in: invoiceIds } });
  }

  await Promise.all([
    DocumentModel.deleteMany({ accountId: { $in: objectIds } }),
    Transaction.deleteMany({ accountId: { $in: objectIds } }),
    Expense.deleteMany({ accountId: { $in: objectIds } }),
    Invoice.deleteMany({ accountId: { $in: objectIds } }),
    Notification.deleteMany({ accountId: { $in: objectIds } }),
    // Bypass append-only middleware — demo cleanup only
    ActivityLog.collection.deleteMany({ accountId: { $in: objectIds } }),
    UserAssignment.deleteMany({ accountId: { $in: objectIds } }),
    DriverTruckAssignment.deleteMany({ accountId: { $in: objectIds } }),
    Driver.deleteMany({ accountId: { $in: objectIds } }),
    Truck.deleteMany({ accountId: { $in: objectIds } }),
    Load.deleteMany({ accountId: { $in: objectIds } }),
  ]);

  const deletedUsers = await User.deleteMany({
    $or: [
      { email: { $in: DEMO_EMAILS } },
      { accountId: { $in: objectIds } },
    ],
  });

  await Account.deleteMany({ _id: { $in: objectIds } });

  return {
    accountIds,
    deletedUsers: deletedUsers.deletedCount ?? 0,
  };
}

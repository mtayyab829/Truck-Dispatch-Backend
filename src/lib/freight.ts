import mongoose from "mongoose";
import { Direction, TransactionType } from "../models/enums.js";
import { Transaction } from "../models/Transaction.js";
import { roundMoney } from "./commission.js";

export async function freightReceivedTotal(
  accountId: string | mongoose.Types.ObjectId,
  loadId: string | mongoose.Types.ObjectId
): Promise<number> {
  const paid = await Transaction.aggregate([
    {
      $match: {
        accountId: new mongoose.Types.ObjectId(String(accountId)),
        loadId: new mongoose.Types.ObjectId(String(loadId)),
        type: TransactionType.FREIGHT_RECEIVED,
        direction: Direction.IN,
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return roundMoney((paid[0]?.total as number) ?? 0);
}

export async function refreshRateSettled(
  accountId: string | mongoose.Types.ObjectId,
  load: { _id: mongoose.Types.ObjectId; rate: number }
): Promise<{ received: number; settled: boolean }> {
  const { Load } = await import("../models/Load.js");
  const received = await freightReceivedTotal(accountId, load._id);
  const settled = received + 0.001 >= load.rate;
  await Load.updateOne({ _id: load._id }, { $set: { rateSettled: settled } });
  return { received, settled };
}

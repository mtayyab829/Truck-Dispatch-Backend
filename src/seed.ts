import { connectDb, disconnectDb } from "./db/connect.js";
import { clearDemoData } from "./db/clearDemo.js";

async function main() {
  await connectDb();
  console.log("Removing demo accounts and related data...");
  const result = await clearDemoData();
  if (result.accountIds.length === 0) {
    console.log("No demo data found.");
  } else {
    console.log(
      `Removed ${result.deletedUsers} user(s) across ${result.accountIds.length} demo account(s).`
    );
  }
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

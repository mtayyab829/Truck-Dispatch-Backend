import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { env } from "../config/env.js";

let memoryServer: MongoMemoryServer | null = null;

/**
 * Connects to MONGODB_URI. If that fails in development, falls back to
 * an in-memory MongoDB so M0 can be verified without Atlas/local install.
 */
export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log("Connected to MongoDB:", env.MONGODB_URI.replace(/\/\/.*@/, "//***@"));
    return mongoose;
  } catch (err) {
    if (env.NODE_ENV === "production") throw err;

    console.warn(
      "Could not connect to MONGODB_URI — starting in-memory MongoDB for development."
    );
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri("truck_dispatch");
    await mongoose.connect(uri);
    console.log("Connected to in-memory MongoDB");
    return mongoose;
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

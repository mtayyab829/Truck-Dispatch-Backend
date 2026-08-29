import mongoose from "mongoose";
import { env } from "../config/env.js";

let memoryServer: { getUri: (db?: string) => string; stop(): Promise<boolean> } | null =
  null;

/**
 * Connects to MONGODB_URI. In development only, falls back to in-memory MongoDB.
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
    const { MongoMemoryServer } = await import("mongodb-memory-server");
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

import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { logActivity } from "../lib/activity.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { UserAssignment } from "../models/UserAssignment.js";
import { UserRole } from "../models/enums.js";
import { serializeDriver, serializeTruck } from "../lib/serializers.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.use(requireAdmin);

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
  role: z.enum([UserRole.ADMIN, UserRole.DISPATCHER]).default(UserRole.DISPATCHER),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.enum([UserRole.ADMIN, UserRole.DISPATCHER]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

const assignSchema = z.object({
  driverIds: z.array(z.string()).default([]),
  truckIds: z.array(z.string()).default([]),
  /** When true, also assign trucks currently linked to selected drivers */
  includeDriverTrucks: z.boolean().default(true),
});

function serializeUser(u: Record<string, unknown>) {
  return {
    id: String(u._id),
    accountId: String(u.accountId),
    name: u.name as string,
    email: u.email as string,
    role: u.role as string,
    isActive: Boolean(u.isActive),
    createdAt: u.createdAt ? new Date(u.createdAt as Date).toISOString() : null,
  };
}

usersRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    const users = await User.find(tenantFilter(scope)).sort({ createdAt: 1 }).lean();
    res.json({ users: users.map(serializeUser) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const user = await User.findOne({
      ...tenantFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!user) throw new AppError("User not found", 404);

    const assignments = await UserAssignment.find({
      ...tenantFilter(scope),
      userId: user._id,
      endDate: null,
    }).lean();

    const driverIds = assignments
      .map((a) => a.driverId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    const truckIds = assignments
      .map((a) => a.truckId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    const [drivers, trucks, allDrivers, allTrucks] = await Promise.all([
      Driver.find({
        accountId: scope.accountId,
        _id: { $in: driverIds },
      }).lean(),
      Truck.find({
        accountId: scope.accountId,
        _id: { $in: truckIds },
      }).lean(),
      Driver.find({ accountId: scope.accountId, isActive: true }).sort({ name: 1 }).lean(),
      Truck.find({ accountId: scope.accountId, isActive: true })
        .sort({ unitNumber: 1 })
        .lean(),
    ]);

    res.json({
      user: serializeUser(user),
      assignedDrivers: drivers.map(serializeDriver),
      assignedTrucks: trucks.map(serializeTruck),
      allDrivers: allDrivers.map(serializeDriver),
      allTrucks: allTrucks.map(serializeTruck),
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    const input = createUserSchema.parse(req.body);
    const exists = await User.findOne({ email: input.email }).lean();
    if (exists) throw new AppError("Email already registered", 409);

    const user = await User.create({
      accountId: scope.accountId,
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, 12),
      isActive: true,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "User",
      entityId: String(user._id),
      action: "USER_CREATED",
      details: { email: user.email, role: user.role },
    });

    res.status(201).json({ user: serializeUser(user.toObject()) });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = updateUserSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.password) patch.passwordHash = await bcrypt.hash(input.password, 12);

    const user = await User.findOneAndUpdate(
      { ...tenantFilter(scope), _id: req.params.id },
      { $set: patch },
      { new: true }
    ).lean();
    if (!user) throw new AppError("User not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "User",
      entityId: String(user._id),
      action: input.isActive === false ? "USER_SUSPENDED" : "USER_UPDATED",
      details: patch,
    });

    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

/** Replace active assignments for a user */
usersRouter.put("/:id/assignments", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    const input = assignSchema.parse(req.body);
    const user = await User.findOne({
      ...tenantFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!user) throw new AppError("User not found", 404);

    const now = new Date();
    await UserAssignment.updateMany(
      { accountId: scope.accountId, userId: user._id, endDate: null },
      { $set: { endDate: now } }
    );

    // Clear previous assignedUserId pointing at this user
    await Driver.updateMany(
      { accountId: scope.accountId, assignedUserId: user._id },
      { $set: { assignedUserId: null } }
    );
    await Truck.updateMany(
      { accountId: scope.accountId, assignedUserId: user._id },
      { $set: { assignedUserId: null } }
    );

    let truckIds = new Set(input.truckIds);
    if (input.includeDriverTrucks && input.driverIds.length) {
      const { DriverTruckAssignment } = await import("../models/DriverTruckAssignment.js");
      const links = await DriverTruckAssignment.find({
        accountId: scope.accountId,
        driverId: { $in: input.driverIds },
        endDate: null,
      }).lean();
      for (const l of links) truckIds.add(String(l.truckId));
    }

    const creates = [];
    for (const driverId of input.driverIds) {
      creates.push({
        accountId: scope.accountId,
        userId: user._id,
        driverId,
        truckId: null,
        startDate: now,
        endDate: null,
      });
    }
    for (const truckId of truckIds) {
      creates.push({
        accountId: scope.accountId,
        userId: user._id,
        driverId: null,
        truckId,
        startDate: now,
        endDate: null,
      });
    }
    if (creates.length) await UserAssignment.insertMany(creates);

    if (input.driverIds.length) {
      await Driver.updateMany(
        { accountId: scope.accountId, _id: { $in: input.driverIds } },
        { $set: { assignedUserId: user._id } }
      );
    }
    if (truckIds.size) {
      await Truck.updateMany(
        { accountId: scope.accountId, _id: { $in: [...truckIds] } },
        { $set: { assignedUserId: user._id } }
      );
    }

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "User",
      entityId: String(user._id),
      action: "USER_ASSIGNMENTS_UPDATED",
      details: {
        driverIds: input.driverIds,
        truckIds: [...truckIds],
      },
    });

    res.json({ ok: true, driverCount: input.driverIds.length, truckCount: truckIds.size });
  } catch (err) {
    next(err);
  }
});

/** Reassign all of a user's fleet/loads to another user (or admin/null) */
usersRouter.post("/:id/reassign", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    if (scope.accountType === "INDIVIDUAL") {
      throw new AppError("Users module is only for company accounts", 403);
    }
    const toUserId = req.body.toUserId ? String(req.body.toUserId) : null;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid id", 400);
    }
    if (toUserId && !mongoose.Types.ObjectId.isValid(toUserId)) {
      throw new AppError("Invalid toUserId", 400);
    }

    const fromUser = await User.findOne({
      ...tenantFilter(scope),
      _id: req.params.id,
    }).lean();
    if (!fromUser) throw new AppError("User not found", 404);

    if (toUserId) {
      const toUser = await User.findOne({
        ...tenantFilter(scope),
        _id: toUserId,
      }).lean();
      if (!toUser) throw new AppError("Target user not found", 404);
    }

    const now = new Date();
    await UserAssignment.updateMany(
      { accountId: scope.accountId, userId: fromUser._id, endDate: null },
      { $set: { endDate: now } }
    );

    await Driver.updateMany(
      { accountId: scope.accountId, assignedUserId: fromUser._id },
      { $set: { assignedUserId: toUserId } }
    );
    await Truck.updateMany(
      { accountId: scope.accountId, assignedUserId: fromUser._id },
      { $set: { assignedUserId: toUserId } }
    );
    await Load.updateMany(
      { accountId: scope.accountId, ownerUserId: fromUser._id },
      { $set: { ownerUserId: toUserId } }
    );

    if (toUserId) {
      const drivers = await Driver.find({
        accountId: scope.accountId,
        assignedUserId: toUserId,
      }).lean();
      const trucks = await Truck.find({
        accountId: scope.accountId,
        assignedUserId: toUserId,
      }).lean();
      const creates = [
        ...drivers.map((d) => ({
          accountId: scope.accountId,
          userId: toUserId,
          driverId: d._id,
          truckId: null,
          startDate: now,
          endDate: null,
        })),
        ...trucks.map((t) => ({
          accountId: scope.accountId,
          userId: toUserId,
          driverId: null,
          truckId: t._id,
          startDate: now,
          endDate: null,
        })),
      ];
      if (creates.length) await UserAssignment.insertMany(creates);
    }

    await User.updateOne({ _id: fromUser._id }, { $set: { isActive: false } });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "User",
      entityId: String(fromUser._id),
      action: "USER_REASSIGNED",
      details: { toUserId },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

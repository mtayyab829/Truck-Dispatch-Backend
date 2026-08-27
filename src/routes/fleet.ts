import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { defaultAssignedUserId, fleetScopeFilter } from "../lib/fleetScope.js";
import { logActivity } from "../lib/activity.js";
import {
  serializeAssignment,
  serializeDriver,
  serializeTruck,
} from "../lib/serializers.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { DriverTruckAssignment } from "../models/DriverTruckAssignment.js";
import {
  createDriverSchema,
  createDriverWithTruckSchema,
  createTruckSchema,
  linkDriverTruckSchema,
  updateDriverSchema,
  updateTruckSchema,
} from "../validators/fleet.js";

export const fleetRouter = Router();
fleetRouter.use(requireAuth);

function assertObjectId(id: string, label = "id"): void {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
}

async function getScopedDriver(scope: ReturnType<typeof getAccountScope>, id: string) {
  assertObjectId(id, "driverId");
  const driver = await Driver.findOne({ ...fleetScopeFilter(scope), _id: id }).lean();
  if (!driver) throw new AppError("Driver not found", 404);
  return driver;
}

async function getScopedTruck(scope: ReturnType<typeof getAccountScope>, id: string) {
  assertObjectId(id, "truckId");
  const truck = await Truck.findOne({ ...fleetScopeFilter(scope), _id: id }).lean();
  if (!truck) throw new AppError("Truck not found", 404);
  return truck;
}

async function currentTruckForDriver(accountId: string, driverId: string) {
  const active = await DriverTruckAssignment.findOne({
    accountId,
    driverId,
    endDate: null,
  })
    .sort({ startDate: -1 })
    .lean();
  if (!active) return null;
  const truck = await Truck.findOne({ _id: active.truckId, accountId }).lean();
  return truck
    ? { assignment: serializeAssignment(active), truck: serializeTruck(truck) }
    : null;
}

async function currentDriverForTruck(accountId: string, truckId: string) {
  const active = await DriverTruckAssignment.findOne({
    accountId,
    truckId,
    endDate: null,
  })
    .sort({ startDate: -1 })
    .lean();
  if (!active) return null;
  const driver = await Driver.findOne({ _id: active.driverId, accountId }).lean();
  return driver
    ? { assignment: serializeAssignment(active), driver: serializeDriver(driver) }
    : null;
}

async function endOpenAssignments(opts: {
  accountId: string;
  driverId?: string;
  truckId?: string;
  endDate: Date;
}) {
  const filter: Record<string, unknown> = {
    accountId: opts.accountId,
    endDate: null,
  };
  if (opts.driverId) filter.driverId = opts.driverId;
  if (opts.truckId) filter.truckId = opts.truckId;

  await DriverTruckAssignment.updateMany(filter, { $set: { endDate: opts.endDate } });
}

async function createAssignment(opts: {
  accountId: string;
  driverId: string;
  truckId: string;
  startDate: Date;
  userId: string;
}) {
  // End any open assignment for this driver or truck before linking
  await endOpenAssignments({
    accountId: opts.accountId,
    driverId: opts.driverId,
    endDate: opts.startDate,
  });
  await endOpenAssignments({
    accountId: opts.accountId,
    truckId: opts.truckId,
    endDate: opts.startDate,
  });

  const assignment = await DriverTruckAssignment.create({
    accountId: opts.accountId,
    driverId: opts.driverId,
    truckId: opts.truckId,
    startDate: opts.startDate,
    endDate: null,
  });

  await logActivity({
    accountId: opts.accountId,
    userId: opts.userId,
    entityType: "DriverTruckAssignment",
    entityId: String(assignment._id),
    action: "DRIVER_TRUCK_LINKED",
    details: {
      driverId: opts.driverId,
      truckId: opts.truckId,
      startDate: opts.startDate.toISOString(),
    },
  });

  return assignment;
}

// ---------- Drivers ----------

fleetRouter.get("/drivers", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const includeInactive = req.query.includeInactive === "true";
    const filter: Record<string, unknown> = { ...fleetScopeFilter(scope) };
    if (!includeInactive) filter.isActive = true;

    const drivers = await Driver.find(filter).sort({ name: 1 }).lean();
    const accountId = String(scope.accountId);

    const items = await Promise.all(
      drivers.map(async (d) => {
        const current = await currentTruckForDriver(accountId, String(d._id));
        return {
          ...serializeDriver(d),
          currentTruck: current?.truck ?? null,
        };
      })
    );

    res.json({ drivers: items });
  } catch (err) {
    next(err);
  }
});

fleetRouter.get("/drivers/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const driver = await getScopedDriver(scope, req.params.id);
    const accountId = String(scope.accountId);

    const assignments = await DriverTruckAssignment.find({
      ...tenantFilter(scope),
      driverId: driver._id,
    })
      .sort({ startDate: -1 })
      .lean();

    const truckIds = [...new Set(assignments.map((a) => String(a.truckId)))];
    const trucks = await Truck.find({
      ...tenantFilter(scope),
      _id: { $in: truckIds },
    }).lean();
    const truckMap = new Map(trucks.map((t) => [String(t._id), serializeTruck(t)]));

    const current = await currentTruckForDriver(accountId, String(driver._id));

    res.json({
      driver: serializeDriver(driver),
      currentTruck: current?.truck ?? null,
      currentAssignment: current?.assignment ?? null,
      assignmentHistory: assignments.map((a) => ({
        ...serializeAssignment(a),
        truck: truckMap.get(String(a.truckId)) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

fleetRouter.post("/drivers", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createDriverSchema.parse(req.body);

    const driver = await Driver.create({
      accountId: scope.accountId,
      assignedUserId: defaultAssignedUserId(scope),
      ...input,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Driver",
      entityId: String(driver._id),
      action: "DRIVER_CREATED",
      details: { name: driver.name },
    });

    res.status(201).json({ driver: serializeDriver(driver.toObject()) });
  } catch (err) {
    next(err);
  }
});

fleetRouter.patch("/drivers/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    await getScopedDriver(scope, req.params.id);
    const input = updateDriverSchema.parse(req.body);

    const driver = await Driver.findOneAndUpdate(
      { ...fleetScopeFilter(scope), _id: req.params.id },
      { $set: input },
      { new: true }
    ).lean();

    if (!driver) throw new AppError("Driver not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Driver",
      entityId: String(driver._id),
      action: "DRIVER_UPDATED",
      details: input,
    });

    res.json({ driver: serializeDriver(driver) });
  } catch (err) {
    next(err);
  }
});

fleetRouter.post("/drivers/:id/deactivate", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    await getScopedDriver(scope, req.params.id);

    const driver = await Driver.findOneAndUpdate(
      { ...fleetScopeFilter(scope), _id: req.params.id },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!driver) throw new AppError("Driver not found", 404);

    await endOpenAssignments({
      accountId: String(scope.accountId),
      driverId: String(driver._id),
      endDate: new Date(),
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Driver",
      entityId: String(driver._id),
      action: "DRIVER_DEACTIVATED",
    });

    res.json({ driver: serializeDriver(driver) });
  } catch (err) {
    next(err);
  }
});

// ---------- Trucks ----------

fleetRouter.get("/trucks", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const includeInactive = req.query.includeInactive === "true";
    const filter: Record<string, unknown> = { ...fleetScopeFilter(scope) };
    if (!includeInactive) filter.isActive = true;

    const trucks = await Truck.find(filter).sort({ unitNumber: 1 }).lean();
    const accountId = String(scope.accountId);

    const items = await Promise.all(
      trucks.map(async (t) => {
        const current = await currentDriverForTruck(accountId, String(t._id));
        return {
          ...serializeTruck(t),
          currentDriver: current?.driver ?? null,
        };
      })
    );

    res.json({ trucks: items });
  } catch (err) {
    next(err);
  }
});

fleetRouter.get("/trucks/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const truck = await getScopedTruck(scope, req.params.id);
    const accountId = String(scope.accountId);

    const assignments = await DriverTruckAssignment.find({
      ...tenantFilter(scope),
      truckId: truck._id,
    })
      .sort({ startDate: -1 })
      .lean();

    const driverIds = [...new Set(assignments.map((a) => String(a.driverId)))];
    const drivers = await Driver.find({
      ...tenantFilter(scope),
      _id: { $in: driverIds },
    }).lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), serializeDriver(d)]));

    const current = await currentDriverForTruck(accountId, String(truck._id));

    res.json({
      truck: serializeTruck(truck),
      currentDriver: current?.driver ?? null,
      currentAssignment: current?.assignment ?? null,
      assignmentHistory: assignments.map((a) => ({
        ...serializeAssignment(a),
        driver: driverMap.get(String(a.driverId)) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

fleetRouter.post("/trucks", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = createTruckSchema.parse(req.body);

    const existing = await Truck.findOne({
      ...tenantFilter(scope),
      unitNumber: input.unitNumber,
    }).lean();
    if (existing) throw new AppError("A truck with this unit number already exists", 409);

    const truck = await Truck.create({
      accountId: scope.accountId,
      assignedUserId: defaultAssignedUserId(scope),
      ...input,
    });

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Truck",
      entityId: String(truck._id),
      action: "TRUCK_CREATED",
      details: { unitNumber: truck.unitNumber },
    });

    res.status(201).json({ truck: serializeTruck(truck.toObject()) });
  } catch (err) {
    next(err);
  }
});

fleetRouter.patch("/trucks/:id", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    await getScopedTruck(scope, req.params.id);
    const input = updateTruckSchema.parse(req.body);

    if (input.unitNumber) {
      const clash = await Truck.findOne({
        ...tenantFilter(scope),
        unitNumber: input.unitNumber,
        _id: { $ne: req.params.id },
      }).lean();
      if (clash) throw new AppError("A truck with this unit number already exists", 409);
    }

    const truck = await Truck.findOneAndUpdate(
      { ...fleetScopeFilter(scope), _id: req.params.id },
      { $set: input },
      { new: true }
    ).lean();

    if (!truck) throw new AppError("Truck not found", 404);

    await logActivity({
      accountId: String(scope.accountId),
      userId: scope.userId,
      entityType: "Truck",
      entityId: String(truck._id),
      action: "TRUCK_UPDATED",
      details: input,
    });

    res.json({ truck: serializeTruck(truck) });
  } catch (err) {
    next(err);
  }
});

// ---------- Link / combined create ----------

fleetRouter.post("/assignments", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const input = linkDriverTruckSchema.parse(req.body);

    await getScopedDriver(scope, input.driverId);
    await getScopedTruck(scope, input.truckId);

    const assignment = await createAssignment({
      accountId: String(scope.accountId),
      driverId: input.driverId,
      truckId: input.truckId,
      startDate: input.startDate,
      userId: scope.userId,
    });

    res.status(201).json({ assignment: serializeAssignment(assignment.toObject()) });
  } catch (err) {
    next(err);
  }
});

/** One guided flow: create driver + truck + active assignment */
fleetRouter.post("/driver-with-truck", async (req, res, next) => {
  let createdDriverId: string | null = null;
  let createdTruckId: string | null = null;

  try {
    const scope = getAccountScope(req.session!);
    const input = createDriverWithTruckSchema.parse(req.body);
    const accountId = String(scope.accountId);
    const assignedUserId = defaultAssignedUserId(scope);

    const existing = await Truck.findOne({
      ...tenantFilter(scope),
      unitNumber: input.truck.unitNumber,
    }).lean();
    if (existing) throw new AppError("A truck with this unit number already exists", 409);

    const driver = await Driver.create({
      accountId: scope.accountId,
      assignedUserId,
      ...input.driver,
    });
    createdDriverId = String(driver._id);

    const truck = await Truck.create({
      accountId: scope.accountId,
      assignedUserId,
      ...input.truck,
    });
    createdTruckId = String(truck._id);

    const assignment = await DriverTruckAssignment.create({
      accountId: scope.accountId,
      driverId: driver._id,
      truckId: truck._id,
      startDate: input.assignmentStartDate,
      endDate: null,
    });

    await logActivity({
      accountId,
      userId: scope.userId,
      entityType: "Driver",
      entityId: String(driver._id),
      action: "DRIVER_WITH_TRUCK_CREATED",
      details: {
        driverId: String(driver._id),
        truckId: String(truck._id),
        assignmentId: String(assignment._id),
        driverName: driver.name,
        unitNumber: truck.unitNumber,
      },
    });

    res.status(201).json({
      driver: serializeDriver(driver.toObject()),
      truck: serializeTruck(truck.toObject()),
      assignment: serializeAssignment(assignment.toObject()),
    });
  } catch (err) {
    // Best-effort cleanup if a later step fails (standalone Mongo has no txn)
    if (createdTruckId) await Truck.deleteOne({ _id: createdTruckId }).catch(() => undefined);
    if (createdDriverId) await Driver.deleteOne({ _id: createdDriverId }).catch(() => undefined);
    next(err);
  }
});

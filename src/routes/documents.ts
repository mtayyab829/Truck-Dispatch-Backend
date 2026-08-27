import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { serializeDocument } from "../lib/serializers.js";
import { DocumentModel } from "../models/Document.js";
import { Load } from "../models/Load.js";
import { LoadAssignment } from "../models/LoadAssignment.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { DocEntityType } from "../models/enums.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const filter: Record<string, unknown> = { ...tenantFilter(scope) };
    if (req.query.entityType) filter.entityType = String(req.query.entityType);
    if (req.query.docType) filter.docType = String(req.query.docType);

    const docs = await DocumentModel.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const now = new Date();

    const loadIds = [
      ...new Set(
        docs
          .filter((d) => d.entityType === DocEntityType.LOAD)
          .map((d) => d.entityId)
          .filter((id) => mongoose.isValidObjectId(id))
      ),
    ];

    const loads =
      loadIds.length > 0
        ? await Load.find({
            ...tenantFilter(scope),
            _id: { $in: loadIds },
          }).lean()
        : [];

    const loadMap = new Map(loads.map((l) => [String(l._id), l]));

    const assignments =
      loadIds.length > 0
        ? await LoadAssignment.find({
            loadId: { $in: loadIds },
            releasedAt: null,
          }).lean()
        : [];

    const assignMap = new Map(
      assignments.map((a) => [String(a.loadId), a])
    );

    const driverIds = [
      ...new Set(assignments.map((a) => String(a.driverId)).filter(Boolean)),
    ];
    const truckIds = [
      ...new Set(assignments.map((a) => String(a.truckId)).filter(Boolean)),
    ];

    const [drivers, trucks] = await Promise.all([
      driverIds.length
        ? Driver.find({ _id: { $in: driverIds } }).lean()
        : Promise.resolve([]),
      truckIds.length
        ? Truck.find({ _id: { $in: truckIds } }).lean()
        : Promise.resolve([]),
    ]);

    const driverMap = new Map(drivers.map((d) => [String(d._id), d]));
    const truckMap = new Map(trucks.map((t) => [String(t._id), t]));

    res.json({
      documents: docs.map((d) => {
        const base = {
          ...serializeDocument(d),
          expiringSoon: d.expiryDate ? new Date(d.expiryDate) <= soon : false,
          expired: d.expiryDate ? new Date(d.expiryDate) < now : false,
          load: null as null | Record<string, unknown>,
        };

        if (d.entityType !== DocEntityType.LOAD) return base;

        const load = loadMap.get(d.entityId);
        if (!load) return base;

        const assignment = assignMap.get(String(load._id));
        const driver = assignment
          ? driverMap.get(String(assignment.driverId))
          : null;
        const truck = assignment
          ? truckMap.get(String(assignment.truckId))
          : null;

        base.load = {
          id: String(load._id),
          loadNumber: load.loadNumber,
          pickupCity: load.pickupCity,
          pickupState: load.pickupState ?? null,
          deliveryCity: load.deliveryCity,
          deliveryState: load.deliveryState ?? null,
          pickupDateTime: load.pickupDateTime
            ? new Date(load.pickupDateTime).toISOString()
            : null,
          deliveryDateTime: load.deliveryDateTime
            ? new Date(load.deliveryDateTime).toISOString()
            : null,
          rate: load.rate,
          loadStatus: load.loadStatus,
          commodity: load.commodity ?? null,
          equipment: load.equipment ?? null,
          miles: load.miles ?? null,
          driver: driver
            ? { id: String(driver._id), name: driver.name as string }
            : null,
          truck: truck
            ? {
                id: String(truck._id),
                unitNumber: truck.unitNumber as string,
              }
            : null,
        };

        return base;
      }),
    });
  } catch (err) {
    next(err);
  }
});

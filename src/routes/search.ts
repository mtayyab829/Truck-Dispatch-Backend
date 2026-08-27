import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAccountScope, tenantFilter } from "../lib/scope.js";
import { fleetScopeFilter } from "../lib/fleetScope.js";
import { loadScopeFilter } from "../lib/loadHelpers.js";
import { Driver } from "../models/Driver.js";
import { Truck } from "../models/Truck.js";
import { Load } from "../models/Load.js";
import { Invoice } from "../models/Invoice.js";

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get("/", async (req, res, next) => {
  try {
    const scope = getAccountScope(req.session!);
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const [drivers, trucks, loads, invoices] = await Promise.all([
      Driver.find({ ...fleetScopeFilter(scope), name: rx }).limit(8).lean(),
      Truck.find({
        ...fleetScopeFilter(scope),
        $or: [{ unitNumber: rx }, { plate: rx }],
      })
        .limit(8)
        .lean(),
      Load.find({
        ...loadScopeFilter(scope),
        $or: [{ loadNumber: rx }, { source: rx }, { pickupCity: rx }, { deliveryCity: rx }],
      })
        .limit(8)
        .lean(),
      Invoice.find({
        ...(scope.isFullAccess
          ? tenantFilter(scope)
          : { ...tenantFilter(scope), createdByUserId: scope.userId }),
        invoiceNumber: rx,
      })
        .limit(8)
        .lean(),
    ]);

    res.json({
      results: [
        ...drivers.map((d) => ({
          type: "driver",
          id: String(d._id),
          label: d.name,
          href: `/fleet/drivers/${d._id}`,
        })),
        ...trucks.map((t) => ({
          type: "truck",
          id: String(t._id),
          label: `Truck #${t.unitNumber}`,
          href: `/fleet/trucks/${t._id}`,
        })),
        ...loads.map((l) => ({
          type: "load",
          id: String(l._id),
          label: `${l.loadNumber} · ${l.pickupCity} → ${l.deliveryCity}`,
          href: `/loads/${l._id}`,
        })),
        ...invoices.map((i) => ({
          type: "invoice",
          id: String(i._id),
          label: i.invoiceNumber,
          href: `/invoices/${i._id}`,
        })),
      ],
    });
  } catch (err) {
    next(err);
  }
});

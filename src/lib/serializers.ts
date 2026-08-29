function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

export function serializeDriver(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    assignedUserId: doc.assignedUserId ? String(doc.assignedUserId) : null,
    name: doc.name as string,
    phone: (doc.phone as string | null) ?? null,
    email: (doc.email as string | null) ?? null,
    cdlNumber: (doc.cdlNumber as string | null) ?? null,
    licenseExpiry: iso(doc.licenseExpiry as Date | null),
    insuranceExpiry: iso(doc.insuranceExpiry as Date | null),
    ownerCompany: (doc.ownerCompany as string | null) ?? null,
    notes: (doc.notes as string | null) ?? null,
    isActive: Boolean(doc.isActive),
    createdAt: iso(doc.createdAt as Date),
    updatedAt: iso(doc.updatedAt as Date),
  };
}

export function serializeTruck(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    assignedUserId: doc.assignedUserId ? String(doc.assignedUserId) : null,
    unitNumber: doc.unitNumber as string,
    plate: (doc.plate as string | null) ?? null,
    vin: (doc.vin as string | null) ?? null,
    make: (doc.make as string | null) ?? null,
    model: (doc.model as string | null) ?? null,
    year: (doc.year as number | null) ?? null,
    type: (doc.type as string | null) ?? null,
    owner: (doc.owner as string | null) ?? null,
    insuranceExpiry: iso(doc.insuranceExpiry as Date | null),
    inspectionExpiry: iso(doc.inspectionExpiry as Date | null),
    status: doc.status as string,
    isActive: Boolean(doc.isActive),
    createdAt: iso(doc.createdAt as Date),
    updatedAt: iso(doc.updatedAt as Date),
  };
}

export function serializeAssignment(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    driverId: String(doc.driverId),
    truckId: String(doc.truckId),
    startDate: iso(doc.startDate as Date),
    endDate: iso(doc.endDate as Date | null),
    createdAt: iso(doc.createdAt as Date),
  };
}

export function serializeLoad(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
    loadNumber: doc.loadNumber as string,
    source: (doc.source as string | null) ?? null,
    pickupCity: doc.pickupCity as string,
    pickupState: (doc.pickupState as string | null) ?? null,
    pickupDateTime: iso(doc.pickupDateTime as Date),
    deliveryCity: doc.deliveryCity as string,
    deliveryState: (doc.deliveryState as string | null) ?? null,
    deliveryDateTime: iso(doc.deliveryDateTime as Date),
    equipment: (doc.equipment as string | null) ?? null,
    commodity: (doc.commodity as string | null) ?? null,
    weight: (doc.weight as number | null) ?? null,
    miles: (doc.miles as number | null) ?? null,
    rate: doc.rate as number,
    commissionType: doc.commissionType as string,
    commissionValue: doc.commissionValue as number,
    commissionAmount: doc.commissionAmount as number,
    commissionSettled: Boolean(doc.commissionSettled),
    rateSettled: Boolean(doc.rateSettled),
    loadStatus: doc.loadStatus as string,
    notes: (doc.notes as string | null) ?? null,
    createdAt: iso(doc.createdAt as Date),
    updatedAt: iso(doc.updatedAt as Date),
  };
}

export function serializeLoadAssignment(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    loadId: String(doc.loadId),
    driverId: String(doc.driverId),
    truckId: String(doc.truckId),
    assignedUserId: doc.assignedUserId ? String(doc.assignedUserId) : null,
    assignedAt: iso(doc.assignedAt as Date),
    releasedAt: iso(doc.releasedAt as Date | null),
  };
}

export function serializeStatusHistory(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    loadId: String(doc.loadId),
    status: doc.status as string,
    changedByUserId: doc.changedByUserId ? String(doc.changedByUserId) : null,
    changedAt: iso(doc.changedAt as Date),
    note: (doc.note as string | null) ?? null,
  };
}

export function serializeDocument(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    entityType: doc.entityType as string,
    entityId: doc.entityId as string,
    fileName: doc.fileName as string,
    fileUrl: doc.fileUrl as string,
    mimeType: (doc.mimeType as string | null) ?? null,
    sizeBytes: (doc.sizeBytes as number | null) ?? null,
    docType: doc.docType as string,
    cloudinaryPublicId: (doc.cloudinaryPublicId as string | null) ?? null,
    expiryDate: iso(doc.expiryDate as Date | null),
    uploadedByUserId: doc.uploadedByUserId ? String(doc.uploadedByUserId) : null,
    createdAt: iso(doc.createdAt as Date),
  };
}

export function serializeTransaction(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    loadId: doc.loadId ? String(doc.loadId) : null,
    driverId: doc.driverId ? String(doc.driverId) : null,
    createdByUserId: doc.createdByUserId ? String(doc.createdByUserId) : null,
    type: doc.type as string,
    direction: doc.direction as string,
    amount: doc.amount as number,
    date: iso(doc.date as Date),
    method: doc.method as string,
    reference: (doc.reference as string | null) ?? null,
    notes: (doc.notes as string | null) ?? null,
    createdAt: iso(doc.createdAt as Date),
  };
}

export function serializeExpense(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    category: doc.category as string,
    amount: doc.amount as number,
    date: iso(doc.date as Date),
    loadId: doc.loadId ? String(doc.loadId) : null,
    driverId: doc.driverId ? String(doc.driverId) : null,
    truckId: doc.truckId ? String(doc.truckId) : null,
    userId: doc.userId ? String(doc.userId) : null,
    notes: (doc.notes as string | null) ?? null,
    createdAt: iso(doc.createdAt as Date),
  };
}

export function serializeInvoice(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    invoiceNumber: doc.invoiceNumber as string,
    kind: (doc.kind as string) ?? "COMMISSION",
    driverId: doc.driverId ? String(doc.driverId) : null,
    billTo: (doc.billTo as string | null) ?? null,
    billToEmail: (doc.billToEmail as string | null) ?? null,
    createdByUserId: doc.createdByUserId ? String(doc.createdByUserId) : null,
    issueDate: iso(doc.issueDate as Date),
    dueDate: iso(doc.dueDate as Date),
    amount: doc.amount as number,
    status: doc.status as string,
    notes: (doc.notes as string | null) ?? null,
    createdAt: iso(doc.createdAt as Date),
    updatedAt: iso(doc.updatedAt as Date),
  };
}

export function serializeInvoiceItem(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    invoiceId: String(doc.invoiceId),
    loadId: String(doc.loadId),
    description: doc.description as string,
    amount: doc.amount as number,
  };
}

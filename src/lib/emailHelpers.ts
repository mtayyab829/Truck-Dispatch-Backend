/** Pull the first email-like token from free text (broker name, notes, etc.). */
export function extractEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match?.[0]?.toLowerCase() ?? null;
}

export function suggestedInvoiceRecipientEmail(input: {
  billToEmail?: string | null;
  billTo?: string | null;
  notes?: string | null;
  driverEmail?: string | null;
  loadSources?: Array<string | null | undefined>;
}): string | null {
  if (input.billToEmail?.trim()) return input.billToEmail.trim().toLowerCase();
  if (input.driverEmail?.trim()) return input.driverEmail.trim().toLowerCase();
  for (const src of input.loadSources ?? []) {
    const fromLoad = extractEmail(src);
    if (fromLoad) return fromLoad;
  }
  return extractEmail(input.billTo) ?? extractEmail(input.notes);
}

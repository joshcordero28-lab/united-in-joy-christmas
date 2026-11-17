/** Normalize guest contact fields for duplicate matching (not for display). */

export function normalizeEmail(input: string | null | undefined): string | null {
  const v = (input || "").trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

/** Digits only; strip leading country trunk zeros inconsistently by keeping last 10+ digits when long. */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input || "").replace(/\D+/g, "");
  if (digits.length < 7) return null;
  // Compare on last 10 digits when longer (common local vs +66 / +1 forms).
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export function normalizeFullName(input: string | null | undefined): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

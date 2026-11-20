import type {BookingStatus} from '../types/database.ts';

export interface SavedApplicantReceipt {
  booking_id: string;
  booking_ref: string;
  applicant_name: string;
  organization: string;
  check_in_date: string;
  check_out_date: string;
  preferred_category: string;
  rooms_required: number;
  num_persons: number;
  status: BookingStatus;
  created_at: string;
}

const RECEIPTS_STORAGE_KEY = 'nadt_blr_applicant_booking_receipts_v1';
const LEGACY_REFS_KEY = 'nadt_blr_recent_booking_refs';

export function readSavedApplicantReceipts(): SavedApplicantReceipt[] {
  try {
    const raw = window.localStorage.getItem(RECEIPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedApplicantReceipt =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.booking_ref === 'string' &&
          item.booking_ref.length > 0,
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function saveApplicantReceipts(items: SavedApplicantReceipt[]): SavedApplicantReceipt[] {
  try {
    const existing = readSavedApplicantReceipts();
    const byRef = new Map<string, SavedApplicantReceipt>();
    for (const item of items) {
      byRef.set(item.booking_ref.trim().toUpperCase(), {
        ...item,
        booking_ref: item.booking_ref.trim().toUpperCase(),
      });
    }
    for (const item of existing) {
      const key = item.booking_ref.trim().toUpperCase();
      if (!byRef.has(key)) {
        byRef.set(key, item);
      }
    }
    const merged = Array.from(byRef.values()).slice(0, 20);
    window.localStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(merged));

    // Keep legacy ref list synced as well
    const legacyRefs = merged.map((r) => r.booking_ref).slice(0, 8);
    window.localStorage.setItem(LEGACY_REFS_KEY, JSON.stringify(legacyRefs));
    return merged;
  } catch {
    return items;
  }
}

export function readAllRecentRefs(): string[] {
  const fromReceipts = readSavedApplicantReceipts().map((r) => r.booking_ref);
  const legacy: string[] = [];
  try {
    const raw = window.localStorage.getItem(LEGACY_REFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((x) => {
          if (typeof x === 'string' && x.trim()) {
            legacy.push(x.trim().toUpperCase());
          }
        });
      }
    }
  } catch {
    // Ignore storage error
  }
  return Array.from(new Set([...fromReceipts, ...legacy])).slice(0, 10);
}

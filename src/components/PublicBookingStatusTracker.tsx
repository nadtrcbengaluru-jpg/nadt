import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {
  AlertCircle,
  Ban,
  BedDouble,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  DoorOpen,
  LogOut,
  Printer,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import {lookupBookingStatusByRef} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import type {BookingStatus, BookingStatusCard} from '../types/database.ts';

interface PublicBookingStatusTrackerProps {
  initialRef?: string;
  checkInTime: string;
  checkOutTime: string;
  contactEmail: string;
  contactPhone: string;
}

const RECENT_REFS_KEY = 'nadt_blr_recent_booking_refs';

function readRecentRefs(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_REFS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, 4);
  } catch {
    return [];
  }
}

export function rememberRecentBookingRef(ref: string): void {
  try {
    const clean = ref.trim().toUpperCase();
    if (!clean) return;
    const prev = readRecentRefs().filter((item) => item !== clean);
    window.localStorage.setItem(
      RECENT_REFS_KEY,
      JSON.stringify([clean, ...prev].slice(0, 4)),
    );
  } catch {
    // Ignore storage failures in private browsing modes
  }
}

function calcNights(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function getStatusPresentation(status: BookingStatus): {
  title: string;
  description: string;
  accentText: string;
  bannerBg: string;
  icon: typeof Clock;
  stepIndex: number;
  isTerminalNegative: boolean;
} {
  switch (status) {
    case 'PENDING':
      return {
        title: 'Pending Administrative Review',
        description:
          'Your request has been received by Campus Administration. Specific rooms are allotted after date-wise availability verification.',
        accentText: 'text-amber-800',
        bannerBg: 'bg-amber-50 border-amber-200',
        icon: Clock,
        stepIndex: 0,
        isTerminalNegative: false,
      };
    case 'APPROVED':
      return {
        title: 'Approved & Room Allotted',
        description:
          'Your hostel accommodation request has been approved. Please carry valid official ID at the time of campus reception check-in.',
        accentText: 'text-emerald-800',
        bannerBg: 'bg-emerald-50 border-emerald-200',
        icon: CheckCircle2,
        stepIndex: 1,
        isTerminalNegative: false,
      };
    case 'CHECKED-IN':
      return {
        title: 'Checked In',
        description:
          'Guest check-in is active at NADT Regional Campus, Bengaluru.',
        accentText: 'text-blue-800',
        bannerBg: 'bg-blue-50 border-blue-200',
        icon: DoorOpen,
        stepIndex: 2,
        isTerminalNegative: false,
      };
    case 'CHECKED-OUT':
      return {
        title: 'Checked Out (Completed)',
        description:
          'Your stay has been completed and checked out in campus records.',
        accentText: 'text-slate-800',
        bannerBg: 'bg-slate-100 border-slate-300',
        icon: LogOut,
        stepIndex: 3,
        isTerminalNegative: false,
      };
    case 'REJECTED':
      return {
        title: 'Request Not Approved',
        description:
          'Campus Administration was unable to approve this request. Review the administration remarks below or contact the desk for alternatives.',
        accentText: 'text-red-800',
        bannerBg: 'bg-red-50 border-red-200',
        icon: XCircle,
        stepIndex: 1,
        isTerminalNegative: true,
      };
    case 'CANCELLED':
      return {
        title: 'Booking Cancelled',
        description:
          'This booking request has been cancelled and any previously held rooms have been released.',
        accentText: 'text-slate-700',
        bannerBg: 'bg-slate-100 border-slate-300',
        icon: Ban,
        stepIndex: 1,
        isTerminalNegative: true,
      };
  }
}

const PROGRESS_STEPS = [
  'Request Submitted',
  'Admin Approved',
  'Checked-In',
  'Checked-Out',
];

export function PublicBookingStatusTracker({
  initialRef = '',
  checkInTime,
  checkOutTime,
  contactEmail,
  contactPhone,
}: PublicBookingStatusTrackerProps) {
  const [refInput, setRefInput] = useState(initialRef);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFoundRef, setNotFoundRef] = useState<string | null>(null);
  const [result, setResult] = useState<BookingStatusCard | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentRefs, setRecentRefs] = useState<string[]>(() => readRecentRefs());

  const runLookup = useCallback(async (rawRef: string) => {
    const clean = rawRef.trim().toUpperCase();
    if (!clean) {
      setError('Enter your Booking Reference Number to check status.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotFoundRef(null);
    try {
      const card = await lookupBookingStatusByRef(clean);
      if (!card) {
        setResult(null);
        setNotFoundRef(clean);
      } else {
        setResult(card);
        rememberRecentBookingRef(card.booking_ref);
        setRecentRefs(readRecentRefs());
      }
    } catch (err) {
      setResult(null);
      setError(extractReadableError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialRef) {
      setRefInput(initialRef);
      void runLookup(initialRef);
    }
  }, [initialRef, runLookup]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runLookup(refInput);
  };

  const handleCopyRef = async (refToCopy: string) => {
    try {
      await navigator.clipboard.writeText(refToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  const presentation = result ? getStatusPresentation(result.status) : null;
  const StatusIcon = presentation?.icon ?? Clock;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h3 className="text-xl font-bold text-slate-900">
          Track Hostel Booking Status
        </h3>
        <p className="text-sm text-slate-600 mt-1">
          Enter your Booking Reference Number to view live approval status, allotted room
          numbers, and administration remarks. No login is required.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
      >
        <div className="flex-1">
          <label
            htmlFor="booking-ref-lookup"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Booking Reference Number *
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="booking-ref-lookup"
              type="text"
              required
              value={refInput}
              onChange={(e) => setRefInput(e.target.value.toUpperCase())}
              placeholder="e.g. NADT-BLR-20261119-A7K2M9P4"
              autoComplete="off"
              className="w-full pl-10 pr-4 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
        >
          {loading ? 'Checking...' : 'Check Status'}
        </button>
      </form>

      {recentRefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Recent on this device:</span>
          {recentRefs.map((recent) => (
            <button
              key={recent}
              type="button"
              onClick={() => {
                setRefInput(recent);
                void runLookup(recent);
              }}
              className="px-2.5 py-1 font-mono text-xs text-[#0F2942] bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 cursor-pointer transition-colors"
            >
              {recent}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {notFoundRef && (
        <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-sm">
          <div className="font-semibold text-slate-900">
            No booking found for{' '}
            <span className="font-mono text-[#0F2942]">{notFoundRef}</span>
          </div>
          <p className="text-slate-600">
            Please verify the exact Booking Reference Number printed on your confirmation slip.
            For further assistance, contact the Campus Administration Desk at{' '}
            <span className="font-mono text-xs text-slate-800">{contactEmail}</span> or{' '}
            <span className="font-mono text-xs text-slate-800">{contactPhone}</span>.
          </p>
        </div>
      )}

      {result && presentation && (
        <div className="space-y-6 pt-2">
          {/* Status Summary Banner */}
          <div
            className={`p-5 rounded-lg border flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${presentation.bannerBg}`}
          >
            <div className="flex items-start gap-3">
              <StatusIcon
                className={`w-5 h-5 shrink-0 mt-0.5 ${presentation.accentText}`}
              />
              <div>
                <div className="text-xs font-mono font-semibold tracking-wide uppercase text-slate-600">
                  Status: {result.status}
                </div>
                <h4 className={`text-lg font-bold mt-0.5 ${presentation.accentText}`}>
                  {presentation.title}
                </h4>
                <p className="text-sm text-slate-700 mt-1 max-w-2xl">
                  {presentation.description}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={loading}
                onClick={() => void runLookup(result.booking_ref)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleCopyRef(result.booking_ref)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Ref
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
            </div>
          </div>

          {/* Progress Stepper */}
          {!presentation.isTerminalNegative && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PROGRESS_STEPS.map((label, idx) => {
                const completed = idx < presentation.stepIndex;
                const current = idx === presentation.stepIndex;
                return (
                  <div
                    key={label}
                    className={`p-3 rounded-lg border text-xs ${
                      current
                        ? 'border-[#0F2942] bg-[#0F2942]/5 text-[#0F2942] font-semibold'
                        : completed
                          ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900 font-medium'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    <div className="font-mono text-[11px] opacity-75">
                      Step {idx + 1}
                    </div>
                    <div className="mt-0.5">{label}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Allotted Rooms Prominent Readout */}
          {result.assigned_room_numbers.length > 0 &&
            result.status !== 'REJECTED' &&
            result.status !== 'CANCELLED' && (
              <div className="p-4 rounded-lg bg-[#0F2942] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <BedDouble className="w-5 h-5 text-amber-300 shrink-0" />
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-300">
                      Allotted Hostel Room(s)
                    </div>
                    <div className="text-lg font-mono font-bold mt-0.5">
                      {result.assigned_room_numbers
                        .map((rm) => `Room ${rm}`)
                        .join(', ')}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-200 font-mono">
                  Check-in {checkInTime} · Check-out {checkOutTime}
                </div>
              </div>
            )}

          {/* Structured Status Details */}
          <div className="border-t border-slate-200 pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">Booking Reference</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5">
                {result.booking_ref}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Stay Dates</div>
              <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                {result.check_in_date} → {result.check_out_date}{' '}
                <span className="text-slate-500">
                  ({calcNights(result.check_in_date, result.check_out_date)} night
                  {calcNights(result.check_in_date, result.check_out_date) === 1
                    ? ''
                    : 's'}
                  )
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Requested Category</div>
              <div className="font-medium text-slate-900 mt-0.5">
                {result.preferred_category} · {result.rooms_required} room
                {result.rooms_required === 1 ? '' : 's'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Allotted Room(s)</div>
              <div className="font-mono text-slate-900 mt-0.5">
                {result.assigned_room_numbers.length > 0
                  ? result.assigned_room_numbers.join(', ')
                  : result.status === 'PENDING'
                    ? 'Pending administrative allotment'
                    : 'None'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Last Updated</div>
              <div className="font-mono text-xs text-slate-700 mt-1">
                {result.updated_at
                  ? new Date(result.updated_at).toLocaleString()
                  : 'Just now'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Official Remarks</div>
              <div className="text-slate-800 mt-0.5">
                {result.admin_remarks || 'No administration remarks posted yet.'}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 border-t border-slate-100 pt-4">
            For applicant privacy, personal contact information is never displayed on the
            public status tracker. Contact Campus Administration ({contactEmail} ·{' '}
            {contactPhone}) for booking amendments.
          </p>
        </div>
      )}
    </div>
  );
}

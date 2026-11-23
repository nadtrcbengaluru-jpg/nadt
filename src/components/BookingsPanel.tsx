import {useEffect, useMemo, useState} from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  Mail,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import type {
  AdminUser,
  Booking,
  BookingStatus,
  RoomCategory,
  SiteSettingsDoc,
} from '../types/database.ts';
import {exportBookingsToCsv} from '../lib/exportUtils.ts';
import {
  checkRoomAvailabilityInFirestore,
  recordAdminExportAuditLog,
  recordBookingEmailAuditLog,
  updateBookingInFirestore,
  type RoomAvailabilityItem,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import {
  buildBookingDecisionEmailDraft,
  buildMailtoFallbackUrl,
  connectGmailAccountForSending,
  getGmailConnectionState,
  isValidEmailAddress,
  sendBookingDecisionEmail,
  subscribeGmailConnection,
  type BookingEmailDraft,
} from '../lib/gmailNotifier.ts';

interface BookingsPanelProps {
  admin: AdminUser;
  bookings: Booking[];
  categories: RoomCategory[];
  settings?: SiteSettingsDoc;
  onRefresh: () => Promise<void>;
}

interface PendingDecisionConfirmation {
  booking: Booking;
  decision: 'APPROVED' | 'REJECTED';
  draft: BookingEmailDraft;
  checkInDate: string;
  checkOutDate: string;
  roomsRequired: number;
  adminRemarks: string;
  selectedRoomIds: string[];
  resendOnly: boolean;
}

const BOOKING_STATUS_OPTIONS: BookingStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CHECKED-IN',
  'CHECKED-OUT',
];

const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  PENDING: 'text-amber-800 bg-amber-50 border-amber-200',
  APPROVED: 'text-emerald-800 bg-emerald-50 border-emerald-200',
  REJECTED: 'text-red-800 bg-red-50 border-red-200',
  CANCELLED: 'text-slate-700 bg-slate-100 border-slate-300',
  'CHECKED-IN': 'text-blue-800 bg-blue-50 border-blue-200',
  'CHECKED-OUT': 'text-zinc-700 bg-zinc-100 border-zinc-300',
};

export function BookingsPanel({
  admin,
  bookings,
  categories,
  settings,
  onRefresh,
}: BookingsPanelProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Gmail OAuth in-memory connection state
  const [gmailState, setGmailState] = useState(() => getGmailConnectionState());
  const [connectingGmail, setConnectingGmail] = useState(false);

  // Selected Booking Review Modal
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editRoomsRequired, setEditRoomsRequired] = useState(1);
  const [editAdminRemarks, setEditAdminRemarks] = useState('');
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

  const [availabilityRooms, setAvailabilityRooms] = useState<RoomAvailabilityItem[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [savingBooking, setSavingBooking] = useState(false);

  // Explicit Email Confirmation Dialog State
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingDecisionConfirmation | null>(null);
  const [sendingDecisionEmail, setSendingDecisionEmail] = useState(false);

  // Retryable failed email context (when Firestore status saved, but email failed)
  const [retryEmailDraft, setRetryEmailDraft] = useState<{
    booking: Booking;
    draft: BookingEmailDraft;
  } | null>(null);

  useEffect(() => {
    setGmailState(getGmailConnectionState());
    return subscribeGmailConnection(() => {
      setGmailState(getGmailConnectionState());
    });
  }, []);

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...bookings]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .filter((b) => {
        if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
        if (categoryFilter !== 'ALL' && b.preferred_category !== categoryFilter) return false;
        if (
          dateFilter &&
          !(b.check_in_date <= dateFilter && b.check_out_date >= dateFilter)
        ) {
          return false;
        }
        if (q) {
          const hay = `${b.booking_ref} ${b.applicant_name} ${b.organization} ${b.email} ${b.mobile}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [bookings, search, statusFilter, categoryFilter, dateFilter]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    dateFilter.length > 0;

  const handleConnectGmail = async () => {
    setError(null);
    setConnectingGmail(true);
    try {
      const res = await connectGmailAccountForSending(admin.email);
      setNotice(
        `Gmail connected${res.senderEmail ? ` (${res.senderEmail})` : ''}. Approval and rejection emails will now be sent automatically after confirmation.`,
      );
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setConnectingGmail(false);
    }
  };

  const handleExportCsv = () => {
    setError(null);
    if (filteredBookings.length === 0) {
      setError('No booking records match the current filters to export.');
      return;
    }
    const prefix = hasActiveFilters
      ? 'NADT_Room_Bookings_Filtered'
      : 'NADT_Room_Bookings';
    const fileName = exportBookingsToCsv(filteredBookings, prefix);
    setNotice(
      `Exported ${filteredBookings.length} booking record${filteredBookings.length === 1 ? '' : 's'} to ${fileName}.`,
    );
    void recordAdminExportAuditLog(
      admin,
      `Exported ${filteredBookings.length} ${hasActiveFilters ? 'filtered ' : ''}booking record(s) to ${fileName}.`,
    );
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh bookings.');
    } finally {
      setRefreshing(false);
    }
  };

  const runAvailabilityCheck = async (
    checkIn: string,
    checkOut: string,
    bookingId: string,
  ) => {
    if (!checkIn || !checkOut || checkIn >= checkOut) return;
    setCheckingAvailability(true);
    try {
      const rooms = await checkRoomAvailabilityInFirestore({
        check_in_date: checkIn,
        check_out_date: checkOut,
        exclude_booking_id: bookingId,
      });
      setAvailabilityRooms(rooms);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setCheckingAvailability(false);
    }
  };

  const openBookingModal = (booking: Booking) => {
    setActiveBooking(booking);
    setEditCheckIn(booking.check_in_date);
    setEditCheckOut(booking.check_out_date);
    setEditRoomsRequired(Number(booking.rooms_required || 1));
    setEditAdminRemarks(booking.admin_remarks || '');
    setSelectedRoomIds(booking.assigned_room_ids || []);
    setError(null);
    void runAvailabilityCheck(
      booking.check_in_date,
      booking.check_out_date,
      booking.booking_id,
    );
  };

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId],
    );
  };

  const resolveSelectedRoomNumbers = (
    roomIds: string[],
    fallbackBooking?: Booking,
  ): string[] => {
    if (roomIds.length === 0) return [];
    const roomMap = new Map(availabilityRooms.map((r) => [r.room_id, r.room_number]));
    const resolved = roomIds
      .map((id) => roomMap.get(id))
      .filter((num): num is string => Boolean(num));
    if (resolved.length === roomIds.length) {
      return resolved;
    }
    if (fallbackBooking && fallbackBooking.assigned_room_numbers.length > 0) {
      return fallbackBooking.assigned_room_numbers;
    }
    return resolved;
  };

  const openDecisionEmailConfirmation = (
    decision: 'APPROVED' | 'REJECTED',
    resendOnly = false,
  ) => {
    if (!activeBooking) return;
    setError(null);

    if (!resendOnly) {
      if (editCheckIn >= editCheckOut) {
        setError('Check-out date must be after check-in date.');
        return;
      }
      if (decision === 'APPROVED' && selectedRoomIds.length === 0) {
        setError('Select at least one available room before approving.');
        return;
      }
    }

    const effectiveRoomIds = resendOnly
      ? activeBooking.assigned_room_ids
      : decision === 'REJECTED'
        ? []
        : selectedRoomIds;

    const assignedRoomNumbers =
      decision === 'APPROVED'
        ? resendOnly
          ? activeBooking.assigned_room_numbers
          : resolveSelectedRoomNumbers(effectiveRoomIds, activeBooking)
        : [];

    const checkIn = resendOnly ? activeBooking.check_in_date : editCheckIn;
    const checkOut = resendOnly ? activeBooking.check_out_date : editCheckOut;
    const remarks = resendOnly ? activeBooking.admin_remarks : editAdminRemarks.trim();

    const draft = buildBookingDecisionEmailDraft({
      booking: activeBooking,
      decision,
      assignedRoomNumbers,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adminRemarks: remarks,
      settings,
    });

    setPendingConfirmation({
      booking: activeBooking,
      decision,
      draft,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomsRequired: resendOnly ? activeBooking.rooms_required : editRoomsRequired,
      adminRemarks: remarks,
      selectedRoomIds: effectiveRoomIds,
      resendOnly,
    });
  };

  const handleConfirmDecision = async (sendEmail: boolean) => {
    if (!pendingConfirmation) return;

    const {
      booking: targetBooking,
      decision,
      draft,
      checkInDate,
      checkOutDate,
      roomsRequired,
      adminRemarks,
      selectedRoomIds: roomIdsToAssign,
      resendOnly,
    } = pendingConfirmation;

    if (sendEmail && !isValidEmailAddress(draft.to)) {
      setError(`Applicant email "${draft.to}" is invalid. Cannot send email notification.`);
      return;
    }

    setSendingDecisionEmail(true);
    setError(null);
    setNotice(null);
    setRetryEmailDraft(null);

    let updatedBooking = targetBooking;

    try {
      if (!resendOnly) {
        updatedBooking = await updateBookingInFirestore(
          targetBooking.booking_id,
          {
            status: decision,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            rooms_required: roomsRequired,
            admin_remarks: adminRemarks,
            assigned_room_ids: decision === 'APPROVED' ? roomIdsToAssign : [],
          },
          admin,
        );
      }
    } catch (err) {
      setSendingDecisionEmail(false);
      setError(extractReadableError(err));
      return;
    }

    const finalDraft = buildBookingDecisionEmailDraft({
      booking: updatedBooking,
      decision,
      assignedRoomNumbers: updatedBooking.assigned_room_numbers,
      checkInDate: updatedBooking.check_in_date,
      checkOutDate: updatedBooking.check_out_date,
      adminRemarks: updatedBooking.admin_remarks,
      settings,
    });

    if (!sendEmail) {
      setPendingConfirmation(null);
      setActiveBooking(null);
      setNotice(
        `Booking ${updatedBooking.booking_ref} updated to ${updatedBooking.status}${
          updatedBooking.assigned_room_numbers.length
            ? ` (Allotted Room(s): ${updatedBooking.assigned_room_numbers.join(', ')})`
            : ''
        }. Email notification was skipped.`,
      );
      setSendingDecisionEmail(false);
      await onRefresh();
      return;
    }

    try {
      const emailRes = await sendBookingDecisionEmail(finalDraft);
      await recordBookingEmailAuditLog({
        actor: admin,
        bookingId: updatedBooking.booking_id,
        bookingRef: updatedBooking.booking_ref,
        recipientEmail: finalDraft.to,
        decision,
        sent: true,
        allottedRooms: updatedBooking.assigned_room_numbers,
      });

      setPendingConfirmation(null);
      setActiveBooking(null);
      setNotice(
        `${
          resendOnly
            ? `Decision email re-sent`
            : `Booking ${updatedBooking.booking_ref} ${updatedBooking.status}`
        }${
          decision === 'APPROVED' && updatedBooking.assigned_room_numbers.length
            ? ` (Allotted Room(s): ${updatedBooking.assigned_room_numbers.join(', ')})`
            : ''
        }. Email notification sent to ${finalDraft.to}${
          emailRes.senderEmail ? ` from ${emailRes.senderEmail}` : ''
        }.`,
      );
      await onRefresh();
    } catch (emailErr) {
      const errMsg = extractReadableError(emailErr);
      await recordBookingEmailAuditLog({
        actor: admin,
        bookingId: updatedBooking.booking_id,
        bookingRef: updatedBooking.booking_ref,
        recipientEmail: finalDraft.to,
        decision,
        sent: false,
        allottedRooms: updatedBooking.assigned_room_numbers,
        errorMessage: errMsg,
      });

      setPendingConfirmation(null);
      setActiveBooking(null);
      setRetryEmailDraft({booking: updatedBooking, draft: finalDraft});
      setError(
        `Booking ${updatedBooking.booking_ref} was saved as ${updatedBooking.status}${
          updatedBooking.assigned_room_numbers.length
            ? ` (Room(s): ${updatedBooking.assigned_room_numbers.join(', ')})`
            : ''
        }, but the email notification to ${finalDraft.to} could not be sent: ${errMsg}`,
      );
      await onRefresh();
    } finally {
      setSendingDecisionEmail(false);
    }
  };

  const handleRetryFailedEmail = async () => {
    if (!retryEmailDraft) return;
    setError(null);
    setSendingDecisionEmail(true);
    try {
      if (!getGmailConnectionState().connected) {
        await connectGmailAccountForSending(admin.email);
      }
      const res = await sendBookingDecisionEmail(retryEmailDraft.draft);
      await recordBookingEmailAuditLog({
        actor: admin,
        bookingId: retryEmailDraft.booking.booking_id,
        bookingRef: retryEmailDraft.booking.booking_ref,
        recipientEmail: retryEmailDraft.draft.to,
        decision: retryEmailDraft.draft.decision,
        sent: true,
        allottedRooms: retryEmailDraft.draft.allottedRooms,
      });
      setNotice(
        `Email notification sent to ${retryEmailDraft.draft.to} for ${retryEmailDraft.booking.booking_ref}${
          res.senderEmail ? ` from ${res.senderEmail}` : ''
        }.`,
      );
      setRetryEmailDraft(null);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSendingDecisionEmail(false);
    }
  };

  const handleBookingAction = async (targetStatus: BookingStatus) => {
    if (!activeBooking) return;
    if (editCheckIn >= editCheckOut) {
      setError('Check-out date must be after check-in date.');
      return;
    }
    if (
      (targetStatus === 'APPROVED' || targetStatus === 'CHECKED-IN') &&
      selectedRoomIds.length === 0
    ) {
      setError('Select at least one available room before approving or checking in.');
      return;
    }

    setSavingBooking(true);
    setError(null);
    setNotice(null);
    try {
      const booking = await updateBookingInFirestore(
        activeBooking.booking_id,
        {
          status: targetStatus,
          check_in_date: editCheckIn,
          check_out_date: editCheckOut,
          rooms_required: editRoomsRequired,
          admin_remarks: editAdminRemarks.trim(),
          assigned_room_ids: selectedRoomIds,
        },
        admin,
      );
      setActiveBooking(null);
      setNotice(
        `Booking ${booking.booking_ref} updated to ${booking.status}${
          booking.assigned_room_numbers.length
            ? ` (Rooms: ${booking.assigned_room_numbers.join(', ')})`
            : ''
        }.`,
      );
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingBooking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Booking Requests &amp; Allocation</h2>
          <p className="text-sm text-slate-600 mt-1">
            Review applicant requests, check date-wise availability, allot rooms, and send
            approval or rejection email notifications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={connectingGmail}
            onClick={() => void handleConnectGmail()}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer border ${
              gmailState.connected
                ? 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                : 'text-amber-900 bg-amber-50 border-amber-300 hover:bg-amber-100'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            {connectingGmail
              ? 'Connecting Gmail...'
              : gmailState.connected
                ? `Gmail Ready${gmailState.senderEmail ? ` (${gmailState.senderEmail})` : ''}`
                : 'Connect Gmail for Email Alerts'}
          </button>
          <button
            type="button"
            disabled={filteredBookings.length === 0}
            onClick={handleExportCsv}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {hasActiveFilters
              ? `Export Filtered CSV (${filteredBookings.length})`
              : `Export CSV (${bookings.length})`}
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleManualRefresh()}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Bookings
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
          {retryEmailDraft && (
            <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
              <a
                href={buildMailtoFallbackUrl(retryEmailDraft.draft)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
              >
                <Mail className="w-3.5 h-3.5" />
                Open Email Draft
              </a>
              <button
                type="button"
                disabled={sendingDecisionEmail}
                onClick={() => void handleRetryFailedEmail()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingDecisionEmail ? 'Sending...' : 'Connect Gmail & Retry Email'}
              </button>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or booking ref..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All Booking Statuses</option>
          {BOOKING_STATUS_OPTIONS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All Room Categories</option>
          {categories.map((c) => (
            <option key={c.category_id} value={c.category_name}>
              {c.category_name}
            </option>
          ))}
        </select>

        <div className="relative">
          <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter active on date"
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>
      </div>

      {/* Bookings Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="py-3 px-4">Reference</th>
              <th className="py-3 px-4">Applicant</th>
              <th className="py-3 px-4">Stay Dates</th>
              <th className="py-3 px-4">Preference</th>
              <th className="py-3 px-4">Assigned Rooms</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {filteredBookings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 px-4 text-center text-sm text-slate-500">
                  No booking requests match the current filters.
                </td>
              </tr>
            ) : (
              filteredBookings.map((b) => (
                <tr key={b.booking_id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {b.booking_ref}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 text-sm">{b.applicant_name}</div>
                    <div className="text-slate-500">
                      {b.organization}
                      {b.designation ? ` · ${b.designation}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                    {b.check_in_date} → {b.check_out_date}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    <div>{b.preferred_category}</div>
                    <div className="text-slate-500">
                      {b.rooms_required} room(s) · {b.num_persons} person(s)
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-900">
                    {b.assigned_room_numbers.length > 0
                      ? b.assigned_room_numbers.join(', ')
                      : 'Unassigned'}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-1 text-[11px] font-semibold rounded border ${
                        BOOKING_STATUS_STYLE[b.status]
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openBookingModal(b)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Booking Review & Room Allocation Modal */}
      {activeBooking && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Booking {activeBooking.booking_ref}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submitted {new Date(activeBooking.created_at).toLocaleString()} · Current
                  Status: <strong>{activeBooking.status}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveBooking(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Applicant Information */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-slate-500">Applicant</div>
                <div className="font-semibold text-slate-900">{activeBooking.applicant_name}</div>
              </div>
              <div>
                <div className="text-slate-500">Organisation / Designation</div>
                <div className="font-medium text-slate-900">
                  {activeBooking.organization}
                  {activeBooking.designation ? ` · ${activeBooking.designation}` : ''}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Registered Contact</div>
                <div className="font-mono text-slate-900 break-all">
                  {activeBooking.email} · {activeBooking.mobile}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Purpose of Visit</div>
                <div className="text-slate-900">{activeBooking.purpose}</div>
              </div>
              <div>
                <div className="text-slate-500">Preferred Category &amp; Guests</div>
                <div className="text-slate-900">
                  {activeBooking.preferred_category} · {activeBooking.num_persons} person(s)
                </div>
              </div>
              <div>
                <div className="text-slate-500">Special Requirements / Remarks</div>
                <div className="text-slate-900">
                  {[activeBooking.special_requirements, activeBooking.applicant_remarks]
                    .filter(Boolean)
                    .join(' | ') || 'None'}
                </div>
              </div>
            </div>

            {/* Editable Dates & Admin Remarks */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Check-in Date
                </label>
                <input
                  type="date"
                  value={editCheckIn}
                  onChange={(e) => {
                    setEditCheckIn(e.target.value);
                    void runAvailabilityCheck(
                      e.target.value,
                      editCheckOut,
                      activeBooking.booking_id,
                    );
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Check-out Date
                </label>
                <input
                  type="date"
                  value={editCheckOut}
                  onChange={(e) => {
                    setEditCheckOut(e.target.value);
                    void runAvailabilityCheck(
                      editCheckIn,
                      e.target.value,
                      activeBooking.booking_id,
                    );
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Rooms Required
                </label>
                <input
                  type="number"
                  min={1}
                  value={editRoomsRequired}
                  onChange={(e) => setEditRoomsRequired(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Selected Rooms
                </label>
                <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono">
                  {selectedRoomIds.length} selected
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Admin Remarks{' '}
                <span className="font-normal text-slate-500">
                  (included in status tracker &amp; decision email to applicant)
                </span>
              </label>
              <textarea
                rows={2}
                value={editAdminRemarks}
                onChange={(e) => setEditAdminRemarks(e.target.value)}
                placeholder="Approval notes, rejection reason, or allotment remarks..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            {/* Date-Wise Room Availability Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-900">
                  Date-Wise Room Availability ({editCheckIn} → {editCheckOut})
                </div>
                {checkingAvailability && (
                  <span className="text-xs text-slate-500">Checking conflicts...</span>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-3 max-h-60 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {availabilityRooms.map((room) => {
                  const isSelected = selectedRoomIds.includes(room.room_id);
                  const selectable = room.is_available_for_dates || isSelected;
                  return (
                    <button
                      key={room.room_id}
                      type="button"
                      disabled={!selectable}
                      onClick={() => toggleRoomSelection(room.room_id)}
                      className={`text-left p-2.5 rounded-lg border text-xs transition-colors ${
                        isSelected
                          ? 'bg-[#0F2942] text-white border-[#0F2942] cursor-pointer'
                          : selectable
                            ? 'bg-white text-slate-800 border-slate-200 hover:border-[#0F2942] cursor-pointer'
                            : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      }`}
                    >
                      <div className="font-mono font-bold">Room {room.room_number}</div>
                      <div className="truncate opacity-85">{room.category_name}</div>
                      {!room.is_available_for_dates && (
                        <div className="text-[10px] truncate mt-0.5 text-red-600">
                          {room.unavailable_reason}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email Notification Status Bar inside Modal */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <Mail className="w-4 h-4 text-[#0F2942] shrink-0" />
                <span>
                  Approving or rejecting will send an email to{' '}
                  <strong className="font-mono text-slate-900">{activeBooking.email}</strong>
                  {' '}(including allotted room number on approval).
                </span>
              </div>
              {!gmailState.connected && (
                <button
                  type="button"
                  disabled={connectingGmail}
                  onClick={() => void handleConnectGmail()}
                  className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-md cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  {connectingGmail ? 'Connecting...' : 'Connect Gmail'}
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => openDecisionEmailConfirmation('REJECTED', false)}
                  className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Reject &amp; Notify
                </button>
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => void handleBookingAction('CANCELLED')}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel Booking
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {(activeBooking.status === 'APPROVED' ||
                  activeBooking.status === 'REJECTED') && (
                  <button
                    type="button"
                    disabled={savingBooking || sendingDecisionEmail}
                    onClick={() =>
                      openDecisionEmailConfirmation(activeBooking.status as 'APPROVED' | 'REJECTED', true)
                    }
                    className="px-3.5 py-2 text-xs font-semibold text-[#0F2942] bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Re-send Email
                  </button>
                )}
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => void handleBookingAction(activeBooking.status)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Save Remarks / Dates
                </button>
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => openDecisionEmailConfirmation('APPROVED', false)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Approve, Assign Rooms &amp; Email
                </button>
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => void handleBookingAction('CHECKED-IN')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
                >
                  Mark Checked-In
                </button>
                <button
                  type="button"
                  disabled={savingBooking || sendingDecisionEmail}
                  onClick={() => void handleBookingAction('CHECKED-OUT')}
                  className="px-4 py-2 text-xs font-semibold text-slate-900 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-lg cursor-pointer"
                >
                  Mark Checked-Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Dialog for Sending Booking Decision Email */}
      {pendingConfirmation && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-[11px] font-bold rounded border ${
                      pendingConfirmation.decision === 'APPROVED'
                        ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                        : 'text-red-800 bg-red-50 border-red-200'
                    }`}
                  >
                    {pendingConfirmation.decision}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">
                    Confirm {pendingConfirmation.resendOnly ? 'Email Re-send' : 'Decision & Email Notification'}
                  </h3>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Review the recipient, allotted room details, and email content before sending via Gmail.
                </p>
              </div>
              <button
                type="button"
                disabled={sendingDecisionEmail}
                onClick={() => setPendingConfirmation(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500">Recipient Registered Email</div>
                <div className="font-mono font-semibold text-slate-900 break-all">
                  {pendingConfirmation.draft.to}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Booking Reference</div>
                <div className="font-mono font-semibold text-slate-900">
                  {pendingConfirmation.booking.booking_ref}
                </div>
              </div>
              {pendingConfirmation.decision === 'APPROVED' && (
                <div className="sm:col-span-2">
                  <div className="text-slate-500">Allotted Room Number(s) Included in Email</div>
                  <div className="font-mono font-bold text-emerald-800 text-sm mt-0.5">
                    {pendingConfirmation.draft.allottedRooms.length > 0
                      ? pendingConfirmation.draft.allottedRooms.join(', ')
                      : 'None'}
                  </div>
                </div>
              )}
              <div className="sm:col-span-2">
                <div className="text-slate-500">Email Subject</div>
                <div className="font-medium text-slate-900">
                  {pendingConfirmation.draft.subject}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1.5">
                Email Message Preview
              </div>
              <pre className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 whitespace-pre-wrap font-mono max-h-56 overflow-y-auto leading-relaxed">
                {pendingConfirmation.draft.bodyText}
              </pre>
            </div>

            {!gmailState.connected && (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span>
                  Gmail send authorization is not active in this session yet. Connect Gmail once
                  to send this notification directly to <strong>{pendingConfirmation.draft.to}</strong>.
                </span>
                <button
                  type="button"
                  disabled={connectingGmail}
                  onClick={() => void handleConnectGmail()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {connectingGmail ? 'Connecting...' : 'Connect Gmail'}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                disabled={sendingDecisionEmail}
                onClick={() => setPendingConfirmation(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {!gmailState.connected && (
                  <a
                    href={buildMailtoFallbackUrl(pendingConfirmation.draft)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Open Email Draft
                  </a>
                )}
                {!pendingConfirmation.resendOnly && (
                  <button
                    type="button"
                    disabled={sendingDecisionEmail}
                    onClick={() => void handleConfirmDecision(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    Save Status Only (Skip Email)
                  </button>
                )}
                <button
                  type="button"
                  disabled={sendingDecisionEmail || !gmailState.connected}
                  onClick={() => void handleConfirmDecision(true)}
                  className={`px-4 py-2 text-xs font-semibold text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    pendingConfirmation.decision === 'APPROVED'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  {sendingDecisionEmail
                    ? 'Processing & Sending...'
                    : pendingConfirmation.resendOnly
                      ? 'Send Decision Email'
                      : `Confirm ${pendingConfirmation.decision} & Send Email`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

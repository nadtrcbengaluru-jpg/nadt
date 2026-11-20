import {useMemo, useState} from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type {
  AdminUser,
  Booking,
  BookingStatus,
  RoomCategory,
} from '../types/database.ts';
import {exportBookingsToCsv} from '../lib/exportUtils.ts';
import {
  checkRoomAvailabilityInFirestore,
  recordAdminExportAuditLog,
  updateBookingInFirestore,
  type RoomAvailabilityItem,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface BookingsPanelProps {
  admin: AdminUser;
  bookings: Booking[];
  categories: RoomCategory[];
  onRefresh: () => Promise<void>;
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
  onRefresh,
}: BookingsPanelProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
            Review applicant requests, check date-wise availability, assign rooms, and manage
            check-in/check-out status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
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
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{error}</span>
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
                <div className="text-slate-500">Contact</div>
                <div className="font-mono text-slate-900">
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
                  (visible to applicant when checking booking status)
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

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savingBooking}
                  onClick={() => void handleBookingAction('REJECTED')}
                  className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg cursor-pointer"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={savingBooking}
                  onClick={() => void handleBookingAction('CANCELLED')}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel Booking
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savingBooking}
                  onClick={() => void handleBookingAction(activeBooking.status)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Save Remarks / Dates
                </button>
                <button
                  type="button"
                  disabled={savingBooking}
                  onClick={() => void handleBookingAction('APPROVED')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Approve &amp; Assign Rooms
                </button>
                <button
                  type="button"
                  disabled={savingBooking}
                  onClick={() => void handleBookingAction('CHECKED-IN')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
                >
                  Mark Checked-In
                </button>
                <button
                  type="button"
                  disabled={savingBooking}
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
    </div>
  );
}

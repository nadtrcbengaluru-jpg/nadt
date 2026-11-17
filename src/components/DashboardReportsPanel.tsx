import {useMemo, useState} from 'react';
import {Download, FileSpreadsheet, FileText, RefreshCw} from 'lucide-react';
import type {Booking, Floor, Room, RoomCategory} from '../types/database.ts';
import {exportRowsToExcel, exportTableToPdf} from '../lib/exportUtils.ts';

interface DashboardReportsPanelProps {
  rooms: Room[];
  floors: Floor[];
  categories: RoomCategory[];
  bookings: Booking[];
  onRefresh: () => Promise<void>;
}

type ReportTab = 'FLOOR' | 'CATEGORY' | 'BOOKINGS_DATE' | 'CR_BUILDING' | 'OCCUPANCY';

export function DashboardReportsPanel({
  rooms,
  floors,
  categories,
  bookings,
  onRefresh,
}: DashboardReportsPanelProps) {
  const [reportTab, setReportTab] = useState<ReportTab>('FLOOR');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  // Dynamic Room Statistics
  const roomStats = useMemo(() => {
    const activeRooms = rooms.filter((r) => r.status !== 'INACTIVE');
    return {
      total: rooms.length,
      available: rooms.filter((r) => r.status === 'AVAILABLE').length,
      booked: rooms.filter((r) => r.status === 'BOOKED').length,
      occupied: rooms.filter((r) => r.status === 'OCCUPIED').length,
      maintenance: rooms.filter((r) => r.status === 'UNDER MAINTENANCE').length,
      crAllocated: rooms.filter((r) => r.building_allocation === 'CR_BUILDING').length,
      single: activeRooms.filter((r) => r.bed_type === 'Single').length,
      double: activeRooms.filter((r) => r.bed_type === 'Double').length,
      queen: activeRooms.filter((r) => r.bed_type === 'Queen Size').length,
      vip: activeRooms.filter((r) => r.bed_type === 'VIP').length,
      ac: activeRooms.filter((r) => r.ac_type === 'AC').length,
      nonAc: activeRooms.filter((r) => r.ac_type === 'Non-AC').length,
      pendingVerification: rooms.filter(
        (r) => r.verification_status === 'PENDING_VERIFICATION',
      ).length,
    };
  }, [rooms]);

  // Dynamic Booking Statistics
  const bookingStats = useMemo(() => {
    const monthlyMap = new Map<
      string,
      {month: string; total: number; approved: number; pending: number; rejected: number}
    >();
    bookings.forEach((b) => {
      const month = (b.check_in_date || b.created_at || '').slice(0, 7) || 'Unknown';
      const entry = monthlyMap.get(month) || {
        month,
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
      };
      entry.total += 1;
      if (b.status === 'APPROVED' || b.status === 'CHECKED-IN' || b.status === 'CHECKED-OUT') {
        entry.approved += 1;
      } else if (b.status === 'PENDING') {
        entry.pending += 1;
      } else if (b.status === 'REJECTED') {
        entry.rejected += 1;
      }
      monthlyMap.set(month, entry);
    });

    return {
      total: bookings.length,
      pending: bookings.filter((b) => b.status === 'PENDING').length,
      approved: bookings.filter((b) => b.status === 'APPROVED').length,
      rejected: bookings.filter((b) => b.status === 'REJECTED').length,
      cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
      checkedIn: bookings.filter((b) => b.status === 'CHECKED-IN').length,
      checkedOut: bookings.filter((b) => b.status === 'CHECKED-OUT').length,
      monthly: Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month)),
    };
  }, [bookings]);

  // 1. Floor-wise Report
  const floorReport = useMemo(() => {
    return [...floors]
      .sort((a, b) => Number(a.display_order) - Number(b.display_order))
      .map((f) => {
        const floorRooms = rooms.filter((r) => r.floor_id === f.floor_id);
        return {
          floor: f.floor_name,
          total: floorRooms.length,
          available: floorRooms.filter((r) => r.status === 'AVAILABLE').length,
          booked: floorRooms.filter((r) => r.status === 'BOOKED').length,
          occupied: floorRooms.filter((r) => r.status === 'OCCUPIED').length,
          maintenance: floorRooms.filter((r) => r.status === 'UNDER MAINTENANCE').length,
          crBuilding: floorRooms.filter((r) => r.building_allocation === 'CR_BUILDING').length,
        };
      });
  }, [floors, rooms]);

  // 2. Category-wise Report
  const categoryReport = useMemo(() => {
    return [...categories]
      .sort((a, b) => Number(a.display_order) - Number(b.display_order))
      .map((c) => {
        const catRooms = rooms.filter((r) => r.category_id === c.category_id);
        return {
          category: c.category_name,
          acType: c.ac_type,
          total: catRooms.length,
          available: catRooms.filter((r) => r.status === 'AVAILABLE').length,
          crBuilding: catRooms.filter((r) => r.building_allocation === 'CR_BUILDING').length,
          bookedOrOccupied: catRooms.filter(
            (r) => r.status === 'BOOKED' || r.status === 'OCCUPIED',
          ).length,
          maintenance: catRooms.filter((r) => r.status === 'UNDER MAINTENANCE').length,
        };
      });
  }, [categories, rooms]);

  // 3. Date-wise Booking Report
  const dateWiseBookings = useMemo(() => {
    return [...bookings]
      .filter((b) => {
        if (fromDate && b.check_in_date < fromDate) return false;
        if (toDate && b.check_in_date > toDate) return false;
        return true;
      })
      .sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date)));
  }, [bookings, fromDate, toDate]);

  // 4. CR Building Allocation Report
  const crBuildingRooms = useMemo(() => {
    return rooms
      .filter((r) => r.building_allocation === 'CR_BUILDING')
      .sort((a, b) =>
        String(a.room_number).localeCompare(String(b.room_number), undefined, {numeric: true}),
      );
  }, [rooms]);

  // 5. Room Occupancy Report
  const occupancyRows = useMemo(() => {
    return rooms
      .filter((r) => r.status !== 'INACTIVE')
      .map((r) => {
        const activeBooking = bookings.find(
          (b) =>
            (b.status === 'CHECKED-IN' || b.status === 'APPROVED') &&
            b.assigned_room_ids.includes(r.room_id),
        );
        return {
          room_number: r.room_number,
          floor_name: r.floor_name,
          category_name: r.category_name,
          status: r.status,
          allocation: r.building_allocation === 'CR_BUILDING' ? 'CR Building' : 'General',
          occupant: activeBooking ? activeBooking.applicant_name : '—',
          booking_ref: activeBooking ? activeBooking.booking_ref : '—',
          stay: activeBooking
            ? `${activeBooking.check_in_date} to ${activeBooking.check_out_date}`
            : '—',
        };
      });
  }, [rooms, bookings]);

  const handleExportActiveReport = (format: 'EXCEL' | 'PDF') => {
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (reportTab === 'FLOOR') {
      if (format === 'EXCEL') {
        exportRowsToExcel(
          `NADT_Floor_Report_${dateStamp}`,
          'Floor Report',
          floorReport.map((r) => ({
            Floor: r.floor,
            'Total Rooms': r.total,
            Available: r.available,
            Booked: r.booked,
            Occupied: r.occupied,
            Maintenance: r.maintenance,
            'CR Building': r.crBuilding,
          })),
        );
      } else {
        exportTableToPdf(
          `NADT_Floor_Report_${dateStamp}`,
          'Floor-Wise Room Inventory Report',
          `Total Rooms: ${roomStats.total}`,
          ['Floor', 'Total', 'Available', 'Booked', 'Occupied', 'Maintenance', 'CR Building'],
          floorReport.map((r) => [
            r.floor,
            r.total,
            r.available,
            r.booked,
            r.occupied,
            r.maintenance,
            r.crBuilding,
          ]),
        );
      }
      return;
    }

    if (reportTab === 'CATEGORY') {
      if (format === 'EXCEL') {
        exportRowsToExcel(
          `NADT_Category_Report_${dateStamp}`,
          'Category Report',
          categoryReport.map((r) => ({
            Category: r.category,
            'AC / Non-AC': r.acType,
            'Total Rooms': r.total,
            Available: r.available,
            'Booked/Occupied': r.bookedOrOccupied,
            Maintenance: r.maintenance,
            'CR Building': r.crBuilding,
          })),
        );
      } else {
        exportTableToPdf(
          `NADT_Category_Report_${dateStamp}`,
          'Category-Wise Room Inventory Report',
          `Total Rooms: ${roomStats.total}`,
          ['Category', 'Climate', 'Total', 'Available', 'Booked/Occupied', 'Maint.', 'CR Bldg'],
          categoryReport.map((r) => [
            r.category,
            r.acType,
            r.total,
            r.available,
            r.bookedOrOccupied,
            r.maintenance,
            r.crBuilding,
          ]),
        );
      }
      return;
    }

    if (reportTab === 'BOOKINGS_DATE') {
      if (format === 'EXCEL') {
        exportRowsToExcel(
          `NADT_Bookings_Report_${dateStamp}`,
          'Bookings Report',
          dateWiseBookings.map((b) => ({
            Reference: b.booking_ref,
            Applicant: b.applicant_name,
            Organisation: b.organization,
            'Check-In': b.check_in_date,
            'Check-Out': b.check_out_date,
            Category: b.preferred_category,
            'Rooms Required': b.rooms_required,
            'Assigned Rooms': b.assigned_room_numbers.join(', '),
            Status: b.status,
          })),
        );
      } else {
        exportTableToPdf(
          `NADT_Bookings_Report_${dateStamp}`,
          'Date-Wise Booking Report',
          `Records: ${dateWiseBookings.length}`,
          ['Ref', 'Applicant', 'Check-In', 'Check-Out', 'Category', 'Rooms', 'Status'],
          dateWiseBookings.map((b) => [
            b.booking_ref,
            b.applicant_name,
            b.check_in_date,
            b.check_out_date,
            b.preferred_category,
            b.assigned_room_numbers.join(', ') || '-',
            b.status,
          ]),
        );
      }
      return;
    }

    if (reportTab === 'CR_BUILDING') {
      if (format === 'EXCEL') {
        exportRowsToExcel(
          `NADT_CR_Building_Report_${dateStamp}`,
          'CR Building',
          crBuildingRooms.map((r) => ({
            'Room Number': r.room_number,
            Floor: r.floor_name,
            Category: r.category_name,
            'AC / Non-AC': r.ac_type,
            Status: r.status,
            Verification: r.verification_status,
            Remarks: r.remarks,
          })),
        );
      } else {
        exportTableToPdf(
          `NADT_CR_Building_Report_${dateStamp}`,
          'CR Building Allocation Report',
          `Allocated Rooms: ${crBuildingRooms.length}`,
          ['Room', 'Floor', 'Category', 'Climate', 'Status', 'Remarks'],
          crBuildingRooms.map((r) => [
            r.room_number,
            r.floor_name,
            r.category_name,
            r.ac_type,
            r.status,
            r.remarks || '-',
          ]),
        );
      }
      return;
    }

    // OCCUPANCY
    if (format === 'EXCEL') {
      exportRowsToExcel(
        `NADT_Occupancy_Report_${dateStamp}`,
        'Room Occupancy',
        occupancyRows.map((r) => ({
          Room: r.room_number,
          Floor: r.floor_name,
          Category: r.category_name,
          Status: r.status,
          Allocation: r.allocation,
          Occupant: r.occupant,
          'Booking Ref': r.booking_ref,
          'Stay Dates': r.stay,
        })),
      );
    } else {
      exportTableToPdf(
        `NADT_Occupancy_Report_${dateStamp}`,
        'Campus Room Occupancy Report',
        `Active Rooms: ${occupancyRows.length}`,
        ['Room', 'Floor', 'Category', 'Status', 'Occupant', 'Booking Ref'],
        occupancyRows.map((r) => [
          r.room_number,
          r.floor_name,
          r.category_name,
          r.status,
          r.occupant,
          r.booking_ref,
        ]),
      );
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Dashboard &amp; Analytical Reports
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Live room inventory and booking metrics calculated dynamically from Firebase Firestore.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Sync Data
        </button>
      </div>

      {/* Room Statistics Grid */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Room Inventory Statistics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Rooms" value={roomStats.total} />
          <StatCard label="Available" value={roomStats.available} tone="green" />
          <StatCard label="Booked" value={roomStats.booked} tone="amber" />
          <StatCard label="Occupied" value={roomStats.occupied} tone="red" />
          <StatCard label="Maintenance" value={roomStats.maintenance} />
          <StatCard label="CR Building" value={roomStats.crAllocated} tone="purple" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Single Rooms" value={roomStats.single} />
          <StatCard label="Double Rooms" value={roomStats.double} />
          <StatCard label="Queen Size" value={roomStats.queen} />
          <StatCard label="VIP Suites" value={roomStats.vip} />
          <StatCard label="AC Rooms" value={roomStats.ac} />
          <StatCard label="Non-AC Rooms" value={roomStats.nonAc} />
        </div>
      </section>

      {/* Booking Statistics Grid */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Booking Statistics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Requests" value={bookingStats.total} />
          <StatCard label="Pending" value={bookingStats.pending} tone="amber" />
          <StatCard label="Approved" value={bookingStats.approved} tone="green" />
          <StatCard label="Current Occupancy" value={bookingStats.checkedIn} tone="red" />
          <StatCard label="Rejected" value={bookingStats.rejected} />
          <StatCard label="Cancelled" value={bookingStats.cancelled} />
        </div>

        {bookingStats.monthly.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-700 mb-3">
              Monthly Booking Statistics
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              {bookingStats.monthly.slice(0, 6).map((m) => (
                <div key={m.month} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="font-mono font-semibold text-slate-900">{m.month}</div>
                  <div className="mt-1 text-slate-600 tabular-nums">
                    {m.total} total · {m.approved} approved
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Detailed Reports + Export */}
      <section className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
            {(
              [
                ['FLOOR', 'Floor-Wise'],
                ['CATEGORY', 'Category-Wise'],
                ['BOOKINGS_DATE', 'Date-Wise Bookings'],
                ['CR_BUILDING', 'CR Building'],
                ['OCCUPANCY', 'Room Occupancy'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setReportTab(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                  reportTab === id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleExportActiveReport('EXCEL')}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => handleExportActiveReport('PDF')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <Download className="w-3 h-3" />
              Export PDF
            </button>
          </div>
        </div>

        {reportTab === 'BOOKINGS_DATE' && (
          <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 text-xs">
            <span className="font-medium text-slate-700">Filter Check-In Range:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="text-slate-600 underline cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {reportTab === 'FLOOR' && (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Floor</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Available</th>
                  <th className="py-3 px-4 text-right">Booked</th>
                  <th className="py-3 px-4 text-right">Occupied</th>
                  <th className="py-3 px-4 text-right">Maintenance</th>
                  <th className="py-3 px-4 text-right">CR Building</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 tabular-nums">
                {floorReport.map((row) => (
                  <tr key={row.floor} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">{row.floor}</td>
                    <td className="py-3 px-4 text-right font-mono">{row.total}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-700">
                      {row.available}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{row.booked}</td>
                    <td className="py-3 px-4 text-right font-mono">{row.occupied}</td>
                    <td className="py-3 px-4 text-right font-mono">{row.maintenance}</td>
                    <td className="py-3 px-4 text-right font-mono text-purple-800">
                      {row.crBuilding}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reportTab === 'CATEGORY' && (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Climate</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Available</th>
                  <th className="py-3 px-4 text-right">Booked / Occupied</th>
                  <th className="py-3 px-4 text-right">Maintenance</th>
                  <th className="py-3 px-4 text-right">CR Building</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 tabular-nums">
                {categoryReport.map((row) => (
                  <tr key={row.category} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">{row.category}</td>
                    <td className="py-3 px-4 text-slate-600">{row.acType}</td>
                    <td className="py-3 px-4 text-right font-mono">{row.total}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-700">
                      {row.available}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{row.bookedOrOccupied}</td>
                    <td className="py-3 px-4 text-right font-mono">{row.maintenance}</td>
                    <td className="py-3 px-4 text-right font-mono text-purple-800">
                      {row.crBuilding}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reportTab === 'BOOKINGS_DATE' && (
            <table className="w-full text-left border-collapse text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-3 px-4">Ref</th>
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Check-In</th>
                  <th className="py-3 px-4">Check-Out</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Assigned Rooms</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {dateWiseBookings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No bookings found for the selected range.
                    </td>
                  </tr>
                ) : (
                  dateWiseBookings.map((b) => (
                    <tr key={b.booking_id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono">{b.booking_ref}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{b.applicant_name}</td>
                      <td className="py-3 px-4 font-mono">{b.check_in_date}</td>
                      <td className="py-3 px-4 font-mono">{b.check_out_date}</td>
                      <td className="py-3 px-4">{b.preferred_category}</td>
                      <td className="py-3 px-4 font-mono">
                        {b.assigned_room_numbers.join(', ') || '—'}
                      </td>
                      <td className="py-3 px-4 font-semibold">{b.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {reportTab === 'CR_BUILDING' && (
            <table className="w-full text-left border-collapse text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Floor</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">AC / Non-AC</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {crBuildingRooms.map((r) => (
                  <tr key={r.room_id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      Room {r.room_number}
                    </td>
                    <td className="py-3 px-4">{r.floor_name}</td>
                    <td className="py-3 px-4">{r.category_name}</td>
                    <td className="py-3 px-4">{r.ac_type}</td>
                    <td className="py-3 px-4 text-purple-800 font-semibold">{r.status}</td>
                    <td className="py-3 px-4 text-slate-600">{r.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reportTab === 'OCCUPANCY' && (
            <table className="w-full text-left border-collapse text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Floor</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Current / Upcoming Guest</th>
                  <th className="py-3 px-4">Booking Ref</th>
                  <th className="py-3 px-4">Stay Dates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {occupancyRows.map((row) => (
                  <tr key={row.room_number} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      Room {row.room_number}
                    </td>
                    <td className="py-3 px-4">{row.floor_name}</td>
                    <td className="py-3 px-4">{row.category_name}</td>
                    <td className="py-3 px-4 font-semibold">{row.status}</td>
                    <td className="py-3 px-4">{row.occupant}</td>
                    <td className="py-3 px-4 font-mono">{row.booking_ref}</td>
                    <td className="py-3 px-4 font-mono">{row.stay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'purple';
}) {
  const valueTone =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-orange-700'
        : tone === 'red'
          ? 'text-red-700'
          : tone === 'purple'
            ? 'text-purple-800'
            : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500 truncate">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${valueTone}`}>
        {value}
      </div>
    </div>
  );
}

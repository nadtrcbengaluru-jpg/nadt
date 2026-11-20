import {useMemo, useState, type FormEvent} from 'react';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  createMaintenanceScheduleInFirestore,
  deleteMaintenanceScheduleInFirestore,
  updateMaintenanceScheduleStatusInFirestore,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import type {
  AdminUser,
  Booking,
  Floor,
  MaintenancePriority,
  MaintenanceSchedule,
  MaintenanceStatus,
  MaintenanceType,
  Room,
  RoomCategory,
} from '../types/database.ts';

interface VisualDashboardPanelProps {
  admin: AdminUser;
  rooms: Room[];
  floors: Floor[];
  categories: RoomCategory[];
  bookings: Booking[];
  maintenanceSchedules: MaintenanceSchedule[];
  onRefresh: () => Promise<void>;
  onNavigate: (tab: 'bookings' | 'rooms' | 'reports') => void;
}

const MAINTENANCE_TYPES: MaintenanceType[] = [
  'HVAC / AC',
  'Electrical',
  'Plumbing',
  'Housekeeping',
  'Furniture & Civil',
  'Inspection',
];

const MAINTENANCE_PRIORITIES: MaintenancePriority[] = [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
];

const STATUS_COLORS: Record<string, string> = {
  Occupied: '#DC2626',
  Booked: '#EA580C',
  Available: '#16A34A',
  'CR Building': '#7C3AED',
  'Under Maintenance': '#64748B',
  Reserved: '#2563EB',
  Inactive: '#3F3F46',
};

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function diffDaysFromToday(dateStr: string): number {
  if (!dateStr) return 999;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date(`${todayYmd()}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 999;
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatPriorityColor(priority: MaintenancePriority): string {
  switch (priority) {
    case 'URGENT':
      return 'text-red-700 font-semibold';
    case 'HIGH':
      return 'text-amber-700 font-semibold';
    case 'NORMAL':
      return 'text-slate-700';
    default:
      return 'text-slate-500';
  }
}

function formatScheduleStatusLabel(status: MaintenanceStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'IN_PROGRESS':
      return {label: 'In Progress', className: 'text-amber-700 font-semibold'};
    case 'SCHEDULED':
      return {label: 'Scheduled', className: 'text-[#0F2942] font-semibold'};
    case 'COMPLETED':
      return {label: 'Completed', className: 'text-emerald-700 font-medium'};
    case 'CANCELLED':
      return {label: 'Cancelled', className: 'text-slate-500 font-medium'};
  }
}

export function VisualDashboardPanel({
  admin,
  rooms,
  floors,
  categories,
  bookings,
  maintenanceSchedules,
  onRefresh,
  onNavigate,
}: VisualDashboardPanelProps) {
  const isSuperAdmin = admin.role === 'SUPER_ADMIN';

  const [refreshing, setRefreshing] = useState(false);
  const [pendingView, setPendingView] = useState<'category' | 'window'>('category');
  const [maintView, setMaintView] = useState<'type' | 'timeline'>('type');
  const [maintListFilter, setMaintListFilter] = useState<'active' | 'all'>('active');

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Schedule Maintenance Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [submittingSchedule, setSubmittingSchedule] = useState(false);
  const [formRoomId, setFormRoomId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<MaintenanceType>('HVAC / AC');
  const [formPriority, setFormPriority] = useState<MaintenancePriority>('NORMAL');
  const [formStartDate, setFormStartDate] = useState(todayYmd());
  const [formEndDate, setFormEndDate] = useState(todayYmd());
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formMarkUnderMaint, setFormMarkUnderMaint] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const activeRooms = useMemo(
    () => rooms.filter((r) => r.is_active && r.status !== 'INACTIVE'),
    [rooms],
  );

  const openScheduleModal = (preselectedRoomId?: string) => {
    const defaultRoom =
      preselectedRoomId ||
      activeRooms[0]?.room_id ||
      rooms[0]?.room_id ||
      '';
    const today = todayYmd();
    setFormRoomId(defaultRoom);
    setFormTitle('');
    setFormType('HVAC / AC');
    setFormPriority('NORMAL');
    setFormStartDate(today);
    setFormEndDate(today);
    setFormAssignedTo('');
    setFormNotes('');
    setFormMarkUnderMaint(false);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSync = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  // --- 1. ROOM OCCUPANCY METRICS & CHART DATA ---
  const occupancyStats = useMemo(() => {
    let occupied = 0;
    let booked = 0;
    let available = 0;
    let maintenance = 0;
    let reserved = 0;
    let crBuilding = 0;
    let inactive = 0;

    for (const r of rooms) {
      if (!r.is_active || r.status === 'INACTIVE') {
        inactive++;
      } else if (
        r.building_allocation === 'CR_BUILDING' ||
        r.status === 'ALLOCATED TO CR BUILDING'
      ) {
        crBuilding++;
      } else if (r.status === 'OCCUPIED') {
        occupied++;
      } else if (r.status === 'BOOKED') {
        booked++;
      } else if (r.status === 'UNDER MAINTENANCE') {
        maintenance++;
      } else if (r.status === 'RESERVED') {
        reserved++;
      } else {
        available++;
      }
    }

    const generalPool = occupied + booked + available + maintenance + reserved;
    const occupiedPlusBooked = occupied + booked;
    const generalOccupancyPct =
      generalPool > 0
        ? Math.round((occupiedPlusBooked / generalPool) * 100)
        : 0;

    const distribution = [
      {name: 'Available', value: available, color: STATUS_COLORS.Available},
      {name: 'Occupied', value: occupied, color: STATUS_COLORS.Occupied},
      {name: 'Booked', value: booked, color: STATUS_COLORS.Booked},
      {name: 'CR Building', value: crBuilding, color: STATUS_COLORS['CR Building']},
      {
        name: 'Under Maintenance',
        value: maintenance,
        color: STATUS_COLORS['Under Maintenance'],
      },
      {name: 'Reserved', value: reserved, color: STATUS_COLORS.Reserved},
      {name: 'Inactive', value: inactive, color: STATUS_COLORS.Inactive},
    ].filter((slice) => slice.value > 0);

    return {
      total: rooms.length,
      occupied,
      booked,
      available,
      maintenance,
      reserved,
      crBuilding,
      inactive,
      generalPool,
      occupiedPlusBooked,
      generalOccupancyPct,
      distribution,
    };
  }, [rooms]);

  const floorChartData = useMemo(() => {
    const orderedFloors = [...floors].sort(
      (a, b) => a.display_order - b.display_order,
    );

    const rows = orderedFloors.map((floor) => {
      const floorRooms = rooms.filter((r) => r.floor_id === floor.floor_id);
      let Occupied = 0;
      let Booked = 0;
      let Available = 0;
      let Maintenance = 0;
      let CR = 0;

      for (const r of floorRooms) {
        if (!r.is_active || r.status === 'INACTIVE') continue;
        if (
          r.building_allocation === 'CR_BUILDING' ||
          r.status === 'ALLOCATED TO CR BUILDING'
        ) {
          CR++;
        } else if (r.status === 'OCCUPIED') {
          Occupied++;
        } else if (r.status === 'BOOKED') {
          Booked++;
        } else if (r.status === 'UNDER MAINTENANCE') {
          Maintenance++;
        } else if (r.status === 'AVAILABLE' || r.status === 'RESERVED') {
          Available++;
        }
      }

      const shortLabel =
        floor.floor_number > 0
          ? `Floor ${floor.floor_number}`
          : floor.floor_name.slice(0, 12);

      return {
        floor: shortLabel,
        fullName: floor.floor_name,
        Occupied,
        Booked,
        Available,
        Maintenance,
        CR,
        total: floorRooms.length,
      };
    });

    const knownFloorIds = new Set(orderedFloors.map((f) => f.floor_id));
    const unassignedRooms = rooms.filter((r) => !knownFloorIds.has(r.floor_id));
    if (unassignedRooms.length > 0) {
      rows.push({
        floor: 'Pending',
        fullName: 'Unassigned / Verification',
        Occupied: unassignedRooms.filter((r) => r.status === 'OCCUPIED').length,
        Booked: unassignedRooms.filter((r) => r.status === 'BOOKED').length,
        Available: unassignedRooms.filter((r) => r.status === 'AVAILABLE').length,
        Maintenance: unassignedRooms.filter(
          (r) => r.status === 'UNDER MAINTENANCE',
        ).length,
        CR: unassignedRooms.filter(
          (r) => r.building_allocation === 'CR_BUILDING',
        ).length,
        total: unassignedRooms.length,
      });
    }

    return rows;
  }, [floors, rooms]);

  // --- 2. PENDING BOOKING REQUESTS METRICS & CHART DATA ---
  const pendingBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'PENDING')
        .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)),
    [bookings],
  );

  const pendingRoomsRequested = useMemo(
    () => pendingBookings.reduce((sum, b) => sum + (b.rooms_required || 1), 0),
    [pendingBookings],
  );

  const urgentPendingCount = useMemo(
    () =>
      pendingBookings.filter((b) => diffDaysFromToday(b.check_in_date) <= 7)
        .length,
    [pendingBookings],
  );

  const pendingByCategoryData = useMemo(() => {
    const map = new Map<
      string,
      {label: string; Requests: number; RoomsNeeded: number}
    >();

    for (const cat of categories) {
      if (!cat.is_bookable) continue;
      map.set(cat.category_name, {
        label: cat.category_name.replace('Queen Size AC', 'Queen AC'),
        Requests: 0,
        RoomsNeeded: 0,
      });
    }

    for (const b of pendingBookings) {
      const key = b.preferred_category || 'Unspecified';
      const existing = map.get(key) || {
        label: key.length > 16 ? `${key.slice(0, 15)}…` : key,
        Requests: 0,
        RoomsNeeded: 0,
      };
      existing.Requests += 1;
      existing.RoomsNeeded += b.rooms_required || 1;
      map.set(key, existing);
    }

    const entries = Array.from(map.values());
    const hasAny = entries.some((e) => e.Requests > 0);
    return hasAny ? entries.filter((e) => e.Requests > 0) : entries;
  }, [categories, pendingBookings]);

  const pendingByWindowData = useMemo(() => {
    const buckets = [
      {label: 'Overdue', Requests: 0, RoomsNeeded: 0},
      {label: 'Next 7d', Requests: 0, RoomsNeeded: 0},
      {label: '8–30 Days', Requests: 0, RoomsNeeded: 0},
      {label: '30+ Days', Requests: 0, RoomsNeeded: 0},
    ];

    for (const b of pendingBookings) {
      const days = diffDaysFromToday(b.check_in_date);
      const idx = days < 0 ? 0 : days <= 7 ? 1 : days <= 30 ? 2 : 3;
      buckets[idx].Requests += 1;
      buckets[idx].RoomsNeeded += b.rooms_required || 1;
    }
    return buckets;
  }, [pendingBookings]);

  // --- 3. UPCOMING MAINTENANCE SCHEDULES METRICS & CHART DATA ---
  const activeSchedules = useMemo(
    () =>
      maintenanceSchedules
        .filter((s) => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS')
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
    [maintenanceSchedules],
  );

  const scheduledRoomIds = useMemo(
    () => new Set(activeSchedules.map((s) => s.room_id)),
    [activeSchedules],
  );

  const unscheduledUnderMaintRooms = useMemo(
    () =>
      rooms.filter(
        (r) =>
          r.status === 'UNDER MAINTENANCE' && !scheduledRoomIds.has(r.room_id),
      ),
    [rooms, scheduledRoomIds],
  );

  const inProgressCount = useMemo(
    () =>
      activeSchedules.filter((s) => s.status === 'IN_PROGRESS').length +
      unscheduledUnderMaintRooms.length,
    [activeSchedules, unscheduledUnderMaintRooms],
  );

  const maintByTypeData = useMemo(() => {
    const counts = new Map<string, {label: string; Scheduled: number; Active: number}>();
    for (const t of MAINTENANCE_TYPES) {
      counts.set(t, {
        label: t === 'Furniture & Civil' ? 'Civil / Furn.' : t,
        Scheduled: 0,
        Active: 0,
      });
    }

    for (const s of activeSchedules) {
      const entry = counts.get(s.maintenance_type) || {
        label: s.maintenance_type,
        Scheduled: 0,
        Active: 0,
      };
      if (s.status === 'IN_PROGRESS') {
        entry.Active += 1;
      } else {
        entry.Scheduled += 1;
      }
      counts.set(s.maintenance_type, entry);
    }

    if (unscheduledUnderMaintRooms.length > 0) {
      counts.set('Unscheduled Block', {
        label: 'Unscheduled',
        Scheduled: 0,
        Active: unscheduledUnderMaintRooms.length,
      });
    }

    const list = Array.from(counts.values());
    const hasAny = list.some((row) => row.Scheduled > 0 || row.Active > 0);
    return hasAny ? list.filter((row) => row.Scheduled > 0 || row.Active > 0) : list;
  }, [activeSchedules, unscheduledUnderMaintRooms]);

  const maintByTimelineData = useMemo(() => {
    const buckets = [
      {label: 'Active Now', Scheduled: 0, Active: unscheduledUnderMaintRooms.length},
      {label: 'Next 7d', Scheduled: 0, Active: 0},
      {label: '8–30 Days', Scheduled: 0, Active: 0},
      {label: '30+ Days', Scheduled: 0, Active: 0},
    ];

    for (const s of activeSchedules) {
      if (s.status === 'IN_PROGRESS') {
        buckets[0].Active += 1;
        continue;
      }
      const days = diffDaysFromToday(s.scheduled_date);
      if (days <= 0) {
        buckets[0].Scheduled += 1;
      } else if (days <= 7) {
        buckets[1].Scheduled += 1;
      } else if (days <= 30) {
        buckets[2].Scheduled += 1;
      } else {
        buckets[3].Scheduled += 1;
      }
    }

    return buckets;
  }, [activeSchedules, unscheduledUnderMaintRooms]);

  const visibleSchedules = useMemo(() => {
    if (maintListFilter === 'active') {
      return activeSchedules;
    }
    return [...maintenanceSchedules].sort((a, b) =>
      b.scheduled_date.localeCompare(a.scheduled_date),
    );
  }, [activeSchedules, maintenanceSchedules, maintListFilter]);

  const handleCreateSchedule = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const selectedRoom = rooms.find((r) => r.room_id === formRoomId);
    if (!selectedRoom) {
      setFormError('Please select a valid room from inventory.');
      return;
    }
    if (!formTitle.trim()) {
      setFormError('Please provide a maintenance task title.');
      return;
    }
    if (!formStartDate || !formEndDate || formStartDate > formEndDate) {
      setFormError('End date must be on or after the scheduled start date.');
      return;
    }

    setSubmittingSchedule(true);
    try {
      await createMaintenanceScheduleInFirestore(
        {
          room: selectedRoom,
          title: formTitle,
          maintenance_type: formType,
          priority: formPriority,
          scheduled_date: formStartDate,
          end_date: formEndDate,
          assigned_to: formAssignedTo,
          notes: formNotes,
          markRoomUnderMaintenance: formMarkUnderMaint,
        },
        admin,
      );
      setModalOpen(false);
      setBannerMessage({
        type: 'success',
        text: `Scheduled maintenance for Room ${selectedRoom.room_number} (${formStartDate} to ${formEndDate}).`,
      });
      await onRefresh();
    } catch (err) {
      setFormError(extractReadableError(err));
    } finally {
      setSubmittingSchedule(false);
    }
  };

  const handleStatusChange = async (
    schedule: MaintenanceSchedule,
    nextStatus: MaintenanceStatus,
  ) => {
    setActionBusyId(schedule.schedule_id);
    setBannerMessage(null);
    try {
      await updateMaintenanceScheduleStatusInFirestore(
        schedule,
        nextStatus,
        admin,
        true,
      );
      setBannerMessage({
        type: 'success',
        text: `Room ${schedule.room_number} maintenance updated to ${formatScheduleStatusLabel(nextStatus).label}.`,
      });
      await onRefresh();
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: extractReadableError(err),
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDeleteSchedule = async (schedule: MaintenanceSchedule) => {
    setActionBusyId(schedule.schedule_id);
    setBannerMessage(null);
    try {
      await deleteMaintenanceScheduleInFirestore(schedule.schedule_id, admin);
      setBannerMessage({
        type: 'success',
        text: `Removed maintenance schedule for Room ${schedule.room_number}.`,
      });
      await onRefresh();
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: extractReadableError(err),
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const totalPendingAlerts = pendingBookings.length;
  const totalUpcomingMaintenance =
    activeSchedules.length + unscheduledUnderMaintRooms.length;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Visual Operations Dashboard
          </h2>
          <p className="text-sm text-slate-600 mt-0.5 font-mono tabular-nums">
            {occupancyStats.total} Total Rooms · {occupancyStats.generalOccupancyPct}% General Occupancy · {totalPendingAlerts} Pending Requests
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleSync()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Sync Data
          </button>
          <button
            type="button"
            onClick={() => openScheduleModal()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#163A5C] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Schedule Maintenance
          </button>
        </div>
      </div>

      {/* Inline Feedback Banner */}
      {bannerMessage && (
        <div
          className={`px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-3 ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Occupancy Rate */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
              General Occupancy Rate
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900 font-mono tabular-nums">
                {occupancyStats.generalOccupancyPct}%
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                ({occupancyStats.occupiedPlusBooked}/{occupancyStats.generalPool})
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 font-mono tabular-nums">
            {occupancyStats.occupied} Occupied · {occupancyStats.booked} Booked · {occupancyStats.available} Free
          </div>
        </div>

        {/* KPI 2: Pending Booking Requests */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Pending Requests
              </span>
              <button
                type="button"
                onClick={() => onNavigate('bookings')}
                className="text-xs font-medium text-[#0F2942] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                Review
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-amber-700 font-mono tabular-nums">
                {totalPendingAlerts}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {pendingRoomsRequested} room{pendingRoomsRequested === 1 ? '' : 's'} requested
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 font-mono tabular-nums">
            {urgentPendingCount} check-in{urgentPendingCount === 1 ? '' : 's'} within 7 days
          </div>
        </div>

        {/* KPI 3: Upcoming Maintenance */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Maintenance Queue
              </span>
              <button
                type="button"
                onClick={() => openScheduleModal()}
                className="text-xs font-medium text-[#0F2942] hover:underline cursor-pointer"
              >
                + Add
              </button>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900 font-mono tabular-nums">
                {totalUpcomingMaintenance}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                active &amp; scheduled
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 font-mono tabular-nums">
            {inProgressCount} In Progress · {occupancyStats.maintenance} Room{occupancyStats.maintenance === 1 ? '' : 's'} Blocked
          </div>
        </div>

        {/* KPI 4: CR Building & Reserved */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                CR &amp; Reserved Pool
              </span>
              <button
                type="button"
                onClick={() => onNavigate('rooms')}
                className="text-xs font-medium text-[#0F2942] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                Inventory
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900 font-mono tabular-nums">
                {occupancyStats.crBuilding + occupancyStats.reserved}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                dedicated rooms
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 font-mono tabular-nums">
            {occupancyStats.crBuilding} CR Building · {occupancyStats.reserved} Reserved
          </div>
        </div>
      </div>

      {/* Row 1: Current Room Occupancy Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Donut Chart: Room Status Distribution */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Current Room Occupancy
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Live status distribution across all {occupancyStats.total} campus rooms
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-slate-600 hover:text-[#0F2942] cursor-pointer whitespace-nowrap"
            >
              Full Report →
            </button>
          </div>

          <div className="relative h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={occupancyStats.distribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={64}
                  outerRadius={94}
                  paddingAngle={2}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                >
                  {occupancyStats.distribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    `${Number(value)} rooms (${
                      occupancyStats.total > 0
                        ? Math.round((Number(value) / occupancyStats.total) * 100)
                        : 0
                    }%)`,
                    String(name),
                  ]}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center KPI overlay */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {occupancyStats.available}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Available
              </span>
            </div>
          </div>

          {/* Accessible breakdown rows */}
          <div className="mt-4 pt-4 border-t border-slate-100 divide-y divide-slate-100">
            {occupancyStats.distribution.map((slice) => {
              const pct =
                occupancyStats.total > 0
                  ? Math.round((slice.value / occupancyStats.total) * 100)
                  : 0;
              return (
                <div
                  key={slice.name}
                  className="py-1.5 flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2 text-slate-700 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{backgroundColor: slice.color}}
                    />
                    {slice.name}
                  </span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {slice.value}{' '}
                    <span className="text-slate-400">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Stacked Bar Chart: Floor-Wise Occupancy */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Floor-Wise Occupancy &amp; Allocation
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Stacked room count by status across each campus floor
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('rooms')}
              className="text-xs font-medium text-slate-600 hover:text-[#0F2942] cursor-pointer whitespace-nowrap"
            >
              Manage Rooms →
            </button>
          </div>

          <div className="flex-1 min-h-[300px] w-full">
            <ResponsiveContainer width="100%" height={310}>
              <BarChart
                data={floorChartData}
                margin={{top: 8, right: 12, left: -16, bottom: 4}}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="floor"
                  tick={{fontSize: 12, fill: '#475569'}}
                  axisLine={{stroke: '#CBD5E1'}}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{fontSize: 12, fill: '#475569'}}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{fill: '#F1F5F9'}}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  iconType="square"
                  wrapperStyle={{fontSize: '12px', paddingTop: '12px'}}
                />
                <Bar
                  dataKey="Occupied"
                  stackId="a"
                  fill={STATUS_COLORS.Occupied}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="Booked"
                  stackId="a"
                  fill={STATUS_COLORS.Booked}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="Available"
                  stackId="a"
                  fill={STATUS_COLORS.Available}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="Maintenance"
                  stackId="a"
                  fill={STATUS_COLORS['Under Maintenance']}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="CR"
                  name="CR Building"
                  stackId="a"
                  fill={STATUS_COLORS['CR Building']}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Row 2: Pending Booking Requests & Upcoming Maintenance Schedules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Pending Booking Requests Card */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Pending Booking Requests
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Awaiting room allotment &amp; administrative approval
              </p>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setPendingView('category')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                  pendingView === 'category'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Category
              </button>
              <button
                type="button"
                onClick={() => setPendingView('window')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                  pendingView === 'window'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Check-In Window
              </button>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  pendingView === 'category'
                    ? pendingByCategoryData
                    : pendingByWindowData
                }
                margin={{top: 8, right: 12, left: -18, bottom: 4}}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="label"
                  tick={{fontSize: 11, fill: '#475569'}}
                  axisLine={{stroke: '#CBD5E1'}}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{fontSize: 11, fill: '#475569'}}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{fill: '#F1F5F9'}}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  iconType="square"
                  wrapperStyle={{fontSize: '12px', paddingTop: '8px'}}
                />
                <Bar
                  dataKey="Requests"
                  name="Pending Requests"
                  fill="#0F2942"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="RoomsNeeded"
                  name="Rooms Required"
                  fill="#D97706"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Soonest Pending Requests List */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Soonest Pending Check-Ins
              </span>
              <button
                type="button"
                onClick={() => onNavigate('bookings')}
                className="text-xs font-medium text-[#0F2942] hover:underline cursor-pointer"
              >
                Open Bookings Queue →
              </button>
            </div>

            {pendingBookings.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                <CalendarClock className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
                All booking requests have been reviewed. No pending approvals right now.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingBookings.slice(0, 4).map((b) => {
                  const daysAway = diffDaysFromToday(b.check_in_date);
                  const urgencyText =
                    daysAway < 0
                      ? 'Overdue'
                      : daysAway === 0
                        ? 'Today'
                        : daysAway <= 7
                          ? `In ${daysAway}d`
                          : b.check_in_date;
                  return (
                    <div
                      key={b.booking_id}
                      className="py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {b.applicant_name}{' '}
                          <span className="font-normal text-slate-500">
                            · {b.organization}
                          </span>
                        </div>
                        <div className="text-slate-500 font-mono tabular-nums mt-0.5 truncate">
                          {b.booking_ref} · {b.preferred_category} ({b.rooms_required}{' '}
                          rm)
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div
                          className={
                            daysAway <= 7
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-700 font-medium'
                          }
                        >
                          {urgencyText}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {b.check_in_date} → {b.check_out_date}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Upcoming Maintenance Schedules Card */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Upcoming Maintenance Schedules
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Planned repairs, inspections &amp; active maintenance blocks
              </p>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setMaintView('type')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                  maintView === 'type'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Work Type
              </button>
              <button
                type="button"
                onClick={() => setMaintView('timeline')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                  maintView === 'timeline'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Timeline
              </button>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={maintView === 'type' ? maintByTypeData : maintByTimelineData}
                margin={{top: 8, right: 12, left: -18, bottom: 4}}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="label"
                  tick={{fontSize: 11, fill: '#475569'}}
                  axisLine={{stroke: '#CBD5E1'}}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{fontSize: 11, fill: '#475569'}}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{fill: '#F1F5F9'}}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  iconType="square"
                  wrapperStyle={{fontSize: '12px', paddingTop: '8px'}}
                />
                <Bar
                  dataKey="Active"
                  name="In Progress"
                  stackId="m"
                  fill="#DC2626"
                  radius={[0, 0, 0, 0]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="Scheduled"
                  name="Scheduled"
                  stackId="m"
                  fill="#0F2942"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Upcoming Maintenance List */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setMaintListFilter('active')}
                  className={`font-semibold cursor-pointer ${
                    maintListFilter === 'active'
                      ? 'text-[#0F2942] underline underline-offset-4'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Upcoming &amp; Active ({activeSchedules.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMaintListFilter('all')}
                  className={`font-semibold cursor-pointer ${
                    maintListFilter === 'all'
                      ? 'text-[#0F2942] underline underline-offset-4'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All History ({maintenanceSchedules.length})
                </button>
              </div>
              <button
                type="button"
                onClick={() => openScheduleModal()}
                className="text-xs font-medium text-[#0F2942] hover:underline cursor-pointer"
              >
                + Schedule
              </button>
            </div>

            {/* Alert rows for rooms marked UNDER MAINTENANCE without a schedule */}
            {maintListFilter === 'active' &&
              unscheduledUnderMaintRooms.length > 0 && (
                <div className="mb-2 pb-2 border-b border-slate-100 space-y-1.5">
                  {unscheduledUnderMaintRooms.map((rm) => (
                    <div
                      key={rm.room_id}
                      className="flex items-center justify-between gap-2 text-xs py-1"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-slate-900">
                          Room {rm.room_number}
                        </span>
                        <span className="text-slate-500">
                          {' '}
                          · {rm.floor_name} · Marked Under Maintenance (no schedule)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openScheduleModal(rm.room_id)}
                        className="text-xs font-medium text-[#0F2942] hover:underline shrink-0 cursor-pointer"
                      >
                        Add Schedule
                      </button>
                    </div>
                  ))}
                </div>
              )}

            {visibleSchedules.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                <Wrench className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
                <p>No maintenance schedules logged yet.</p>
                <button
                  type="button"
                  onClick={() => openScheduleModal()}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#163A5C] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Schedule First Maintenance
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto pr-1">
                {visibleSchedules.map((sched) => {
                  const statusMeta = formatScheduleStatusLabel(sched.status);
                  const busy = actionBusyId === sched.schedule_id;
                  return (
                    <div
                      key={sched.schedule_id}
                      className="py-2.5 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          <span className="font-mono">Room {sched.room_number}</span>
                          <span className="font-normal text-slate-500">
                            {' '}
                            · {sched.title}
                          </span>
                        </div>
                        <div className="text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                          <span>{sched.maintenance_type}</span>
                          <span>·</span>
                          <span className={formatPriorityColor(sched.priority)}>
                            {sched.priority}
                          </span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {sched.scheduled_date}
                            {sched.end_date !== sched.scheduled_date
                              ? ` → ${sched.end_date}`
                              : ''}
                          </span>
                          {sched.assigned_to && (
                            <>
                              <span>·</span>
                              <span>{sched.assigned_to}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[11px] mr-1 ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>

                        {sched.status === 'SCHEDULED' && (
                          <button
                            type="button"
                            disabled={busy}
                            title="Start maintenance (marks room Under Maintenance)"
                            onClick={() =>
                              void handleStatusChange(sched, 'IN_PROGRESS')
                            }
                            className="p-1 text-slate-600 hover:text-[#0F2942] hover:bg-slate-100 rounded cursor-pointer disabled:opacity-40"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {(sched.status === 'SCHEDULED' ||
                          sched.status === 'IN_PROGRESS') && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              title="Mark Completed (restores room to Available)"
                              onClick={() =>
                                void handleStatusChange(sched, 'COMPLETED')
                              }
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer disabled:opacity-40"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="Cancel schedule"
                              onClick={() =>
                                void handleStatusChange(sched, 'CANCELLED')
                              }
                              className="p-1 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer disabled:opacity-40"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {isSuperAdmin && (
                          <button
                            type="button"
                            disabled={busy}
                            title="Delete record"
                            onClick={() => void handleDeleteSchedule(sched)}
                            className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Schedule Maintenance Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Schedule Room Maintenance
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Logged directly to Cloud Firestore with full audit trail
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateSchedule(e)} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Room *
                  </label>
                  <select
                    required
                    value={formRoomId}
                    onChange={(e) => setFormRoomId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                  >
                    {activeRooms.map((r) => (
                      <option key={r.room_id} value={r.room_id}>
                        Room {r.room_number} — {r.floor_name} ({r.category_name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Work Type *
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as MaintenanceType)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                  >
                    {MAINTENANCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Maintenance Task Title *
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Split AC gas refill & filter servicing"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={(e) => {
                      setFormStartDate(e.target.value);
                      if (e.target.value > formEndDate) {
                        setFormEndDate(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    min={formStartDate}
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Priority *
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) =>
                      setFormPriority(e.target.value as MaintenancePriority)
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                  >
                    {MAINTENANCE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Technician / Vendor
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={formAssignedTo}
                  onChange={(e) => setFormAssignedTo(e.target.value)}
                  placeholder="e.g., CPWD Electrical Team / Campus Caretaker"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional scope of work or parts required..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formMarkUnderMaint}
                  onChange={(e) => setFormMarkUnderMaint(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  Start immediately and mark room{' '}
                  <strong className="font-semibold">UNDER MAINTENANCE</strong>{' '}
                  (blocks room from new bookings until completed)
                </span>
              </label>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSchedule}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#163A5C] cursor-pointer disabled:opacity-60"
                >
                  {submittingSchedule ? 'Saving...' : 'Save Maintenance Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

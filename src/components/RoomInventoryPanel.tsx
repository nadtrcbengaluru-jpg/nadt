import {useMemo, useState, type ChangeEvent, type FormEvent} from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AcType,
  AdminUser,
  BedType,
  BuildingAllocation,
  Floor,
  Room,
  RoomCategory,
  RoomStatus,
} from '../types/database.ts';
import {
  bulkImportRoomsInFirestore,
  createRoomInFirestore,
  deleteOrRetireRoomInFirestore,
  updateRoomInFirestore,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import {exportRowsToExcel, parseRoomSpreadsheetFile} from '../lib/exportUtils.ts';

interface RoomInventoryPanelProps {
  admin: AdminUser;
  rooms: Room[];
  floors: Floor[];
  categories: RoomCategory[];
  onRefresh: () => Promise<void>;
}

const ROOM_STATUS_OPTIONS: RoomStatus[] = [
  'AVAILABLE',
  'BOOKED',
  'OCCUPIED',
  'UNDER MAINTENANCE',
  'RESERVED',
  'ALLOCATED TO CR BUILDING',
  'INACTIVE',
];

const STATUS_CARD_STYLES: Record<
  RoomStatus,
  {card: string; label: string; badgeText: string}
> = {
  AVAILABLE: {
    card: 'bg-emerald-50/70 border-emerald-300 hover:border-emerald-500',
    label: 'Available',
    badgeText: 'text-emerald-800',
  },
  BOOKED: {
    card: 'bg-orange-50/80 border-orange-300 hover:border-orange-500',
    label: 'Booked',
    badgeText: 'text-orange-800',
  },
  OCCUPIED: {
    card: 'bg-red-50/80 border-red-300 hover:border-red-500',
    label: 'Occupied',
    badgeText: 'text-red-800',
  },
  'UNDER MAINTENANCE': {
    card: 'bg-slate-100 border-slate-300 hover:border-slate-500',
    label: 'Under Maintenance',
    badgeText: 'text-slate-700',
  },
  RESERVED: {
    card: 'bg-blue-50/80 border-blue-300 hover:border-blue-500',
    label: 'Reserved',
    badgeText: 'text-blue-800',
  },
  'ALLOCATED TO CR BUILDING': {
    card: 'bg-purple-50/80 border-purple-300 hover:border-purple-500',
    label: 'CR Building',
    badgeText: 'text-purple-800',
  },
  INACTIVE: {
    card: 'bg-zinc-200/80 border-zinc-400 hover:border-zinc-600',
    label: 'Inactive',
    badgeText: 'text-zinc-800',
  },
};

export function RoomInventoryPanel({
  admin,
  rooms,
  floors,
  categories,
  onRefresh,
}: RoomInventoryPanelProps) {
  const isSuperAdmin = admin.role === 'SUPER_ADMIN';

  const [selectedFloorId, setSelectedFloorId] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [acFilter, setAcFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [allocationFilter, setAllocationFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Room Detail / Edit Modal
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [isEditingRoom, setIsEditingRoom] = useState(false);
  const [confirmDeleteMode, setConfirmDeleteMode] = useState<'NONE' | 'RETIRE' | 'PERMANENT'>('NONE');
  const [savingRoom, setSavingRoom] = useState(false);

  // Add Room Modal
  const [showAddModal, setShowAddModal] = useState(false);

  // Bulk Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<Array<Partial<Room>>>([]);
  const [importing, setImporting] = useState(false);

  // Shared Form State for Add/Edit
  const [formRoomNumber, setFormRoomNumber] = useState('');
  const [formFloorId, setFormFloorId] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formBedType, setFormBedType] = useState<BedType>('Single');
  const [formAcType, setFormAcType] = useState<AcType>('Non-AC');
  const [formCapacity, setFormCapacity] = useState(1);
  const [formAllocation, setFormAllocation] = useState<BuildingAllocation>('GENERAL');
  const [formStatus, setFormStatus] = useState<RoomStatus>('AVAILABLE');
  const [formVerification, setFormVerification] = useState<'VERIFIED' | 'PENDING_VERIFICATION'>('VERIFIED');
  const [formRemarks, setFormRemarks] = useState('');

  const sortedFloors = useMemo(
    () => [...floors].sort((a, b) => Number(a.display_order) - Number(b.display_order)),
    [floors],
  );

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms
      .filter((r) => {
        if (selectedFloorId !== 'ALL' && r.floor_id !== selectedFloorId) return false;
        if (acFilter !== 'ALL' && r.ac_type !== acFilter) return false;
        if (categoryFilter !== 'ALL' && r.category_id !== categoryFilter) return false;
        if (allocationFilter !== 'ALL' && r.building_allocation !== allocationFilter) return false;
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        if (q) {
          const hay = `${r.room_number} ${r.category_name} ${r.floor_name} ${r.remarks}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) =>
        String(a.room_number).localeCompare(String(b.room_number), undefined, {numeric: true}),
      );
  }, [rooms, selectedFloorId, acFilter, categoryFilter, allocationFilter, statusFilter, search]);

  const floorCounts = useMemo(() => {
    const map: Record<string, number> = {ALL: rooms.length};
    rooms.forEach((r) => {
      map[r.floor_id] = (map[r.floor_id] || 0) + 1;
    });
    return map;
  }, [rooms]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh room inventory.');
    } finally {
      setRefreshing(false);
    }
  };

  const openAddModal = () => {
    const defaultFloor = sortedFloors[0];
    const defaultCategory = categories[0];
    setFormRoomNumber('');
    setFormFloorId(defaultFloor?.floor_id || 'FL-1');
    setFormCategoryId(defaultCategory?.category_id || 'CAT-S-NAC');
    setFormBedType(defaultCategory?.bed_type || 'Single');
    setFormAcType(defaultCategory?.ac_type || 'Non-AC');
    setFormCapacity(Number(defaultCategory?.default_capacity || 1));
    setFormAllocation('GENERAL');
    setFormStatus('AVAILABLE');
    setFormVerification('VERIFIED');
    setFormRemarks('');
    setShowAddModal(true);
  };

  const openRoomDetail = (room: Room) => {
    setActiveRoom(room);
    setIsEditingRoom(false);
    setConfirmDeleteMode('NONE');
    setFormRoomNumber(String(room.room_number));
    setFormFloorId(room.floor_id);
    setFormCategoryId(room.category_id);
    setFormBedType(room.bed_type);
    setFormAcType(room.ac_type);
    setFormCapacity(Number(room.capacity || 1));
    setFormAllocation(room.building_allocation);
    setFormStatus(room.status);
    setFormVerification(room.verification_status || 'VERIFIED');
    setFormRemarks(room.remarks || '');
  };

  const handleCategorySelectionChange = (catId: string) => {
    setFormCategoryId(catId);
    const cat = categories.find((c) => c.category_id === catId);
    if (cat) {
      setFormBedType(cat.bed_type);
      setFormAcType(cat.ac_type);
      setFormCapacity(Number(cat.default_capacity || 1));
      if (cat.category_id !== 'CAT-UNID') {
        setFormVerification('VERIFIED');
      }
    }
  };

  const handleAllocationFormChange = (alloc: BuildingAllocation) => {
    setFormAllocation(alloc);
    if (alloc === 'CR_BUILDING') {
      setFormStatus('ALLOCATED TO CR BUILDING');
    } else if (formStatus === 'ALLOCATED TO CR BUILDING') {
      setFormStatus('AVAILABLE');
    }
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavingRoom(true);
    setError(null);
    setNotice(null);
    try {
      const floor = floors.find((f) => f.floor_id === formFloorId);
      const cat = categories.find((c) => c.category_id === formCategoryId);
      const room = await createRoomInFirestore(
        {
          room_number: formRoomNumber.trim(),
          floor_id: formFloorId,
          floor_name: floor?.floor_name || formFloorId,
          category_id: formCategoryId,
          category_name: cat?.category_name || formCategoryId,
          bed_type: formBedType,
          ac_type: formAcType,
          capacity: formCapacity,
          building_allocation: formAllocation,
          status: formStatus,
          verification_status: formVerification,
          remarks: formRemarks.trim(),
        },
        admin,
      );
      setShowAddModal(false);
      setNotice(`Room ${room.room_number} added to Firestore inventory.`);
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingRoom(false);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    setSavingRoom(true);
    setError(null);
    setNotice(null);
    try {
      const floor = floors.find((f) => f.floor_id === formFloorId);
      const cat = categories.find((c) => c.category_id === formCategoryId);
      const room = await updateRoomInFirestore(
        activeRoom.room_id,
        {
          room_number: formRoomNumber.trim(),
          floor_id: formFloorId,
          floor_name: floor?.floor_name || formFloorId,
          category_id: formCategoryId,
          category_name: cat?.category_name || formCategoryId,
          bed_type: formBedType,
          ac_type: formAcType,
          capacity: formCapacity,
          building_allocation: formAllocation,
          status: formStatus,
          verification_status: formVerification,
          remarks: formRemarks.trim(),
        },
        admin,
      );
      setActiveRoom(room);
      setIsEditingRoom(false);
      setNotice(`Room ${room.room_number} updated successfully.`);
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingRoom(false);
    }
  };

  const handleQuickStatusUpdate = async (nextStatus: RoomStatus) => {
    if (!activeRoom) return;
    setSavingRoom(true);
    setError(null);
    try {
      const room = await updateRoomInFirestore(
        activeRoom.room_id,
        {
          status: nextStatus,
          building_allocation:
            nextStatus === 'ALLOCATED TO CR BUILDING'
              ? 'CR_BUILDING'
              : activeRoom.building_allocation === 'CR_BUILDING' &&
                  nextStatus === 'AVAILABLE'
                ? 'GENERAL'
                : activeRoom.building_allocation,
        },
        admin,
      );
      setActiveRoom(room);
      setFormStatus(room.status);
      setFormAllocation(room.building_allocation);
      setNotice(`Room ${room.room_number} status set to ${room.status}.`);
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingRoom(false);
    }
  };

  const handleDeleteConfirm = async (permanent: boolean) => {
    if (!activeRoom) return;
    setSavingRoom(true);
    setError(null);
    try {
      const res = await deleteOrRetireRoomInFirestore(
        activeRoom.room_id,
        permanent,
        admin,
      );
      setActiveRoom(null);
      setConfirmDeleteMode('NONE');
      setNotice(
        res.action === 'DELETED'
          ? `Room ${activeRoom.room_number} permanently deleted.`
          : `Room ${activeRoom.room_number} marked INACTIVE (historical booking records preserved).`,
      );
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingRoom(false);
    }
  };

  const handleExportInventory = () => {
    exportRowsToExcel(
      `NADT_Bengaluru_Room_Inventory_${new Date().toISOString().slice(0, 10)}`,
      'Rooms',
      filteredRooms.map((r) => ({
        'Room ID': r.room_id,
        'Room Number': r.room_number,
        Floor: r.floor_name,
        Category: r.category_name,
        'Bed Type': r.bed_type,
        'AC / Non-AC': r.ac_type,
        Capacity: r.capacity,
        'Building Allocation':
          r.building_allocation === 'CR_BUILDING' ? 'CR Building' : 'General Inventory',
        Status: r.status,
        Verification: r.verification_status,
        Remarks: r.remarks,
      })),
    );
  };

  const handleDownloadSampleCsv = () => {
    const csv = [
      'room_number,floor_id,floor_name,category_id,category_name,bed_type,ac_type,capacity,building_allocation,status,remarks',
      '116,FL-1,First Floor,CAT-S-NAC,Single Non-AC,Single,Non-AC,1,GENERAL,AVAILABLE,Sample new room',
    ].join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'room_import_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const rawRows = await parseRoomSpreadsheetFile(file);
      const normalized: Array<Partial<Room>> = rawRows.map((row) => ({
        room_number: String(row.room_number ?? row['Room Number'] ?? '').trim(),
        floor_id: String(row.floor_id ?? 'FL-1').trim(),
        floor_name: String(row.floor_name ?? row['Floor'] ?? 'First Floor').trim(),
        category_id: String(row.category_id ?? 'CAT-S-NAC').trim(),
        category_name: String(row.category_name ?? row['Category'] ?? 'Single Non-AC').trim(),
        bed_type: String(row.bed_type ?? row['Bed Type'] ?? 'Single').trim() as BedType,
        ac_type: String(row.ac_type ?? row['AC / Non-AC'] ?? 'Non-AC').trim() as AcType,
        capacity: Number(row.capacity ?? row['Capacity'] ?? 1) || 1,
        building_allocation:
          String(row.building_allocation ?? row['Building Allocation'] ?? '')
            .toUpperCase()
            .includes('CR')
            ? 'CR_BUILDING'
            : 'GENERAL',
        status: String(row.status ?? row['Status'] ?? 'AVAILABLE').trim() as RoomStatus,
        remarks: String(row.remarks ?? row['Remarks'] ?? '').trim(),
      }));
      setImportPreview(normalized.filter((r) => Boolean(r.room_number)));
    } catch {
      setError('Could not parse the selected CSV/Excel file.');
    }
  };

  const handleConfirmImport = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await bulkImportRoomsInFirestore(importPreview, admin);
      setShowImportModal(false);
      setImportPreview([]);
      setNotice(
        `Bulk import finished: ${res.created} room(s) created, ${res.skipped} skipped.${
          res.errors.length ? ` Notes: ${res.errors.slice(0, 3).join('; ')}` : ''
        }`,
      );
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Dynamic Room Inventory &amp; Floor Display
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Manage rooms, AC/Non-AC conversions, floor allocations, and CR Building reservations
            in Firebase Firestore.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleManualRefresh()}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExportInventory}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Bulk Import
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Room
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

      {/* Six Floor Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        <button
          type="button"
          onClick={() => setSelectedFloorId('ALL')}
          className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            selectedFloorId === 'ALL'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Floors ({floorCounts.ALL || 0})
        </button>
        {sortedFloors.map((floor) => (
          <button
            key={floor.floor_id}
            type="button"
            onClick={() => setSelectedFloorId(floor.floor_id)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              selectedFloorId === floor.floor_id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {floor.floor_name} ({floorCounts[floor.floor_id] || 0})
          </button>
        ))}
      </div>

      {/* Multi-Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search room number..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <select
          value={acFilter}
          onChange={(e) => setAcFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All AC / Non-AC</option>
          <option value="AC">AC Only</option>
          <option value="Non-AC">Non-AC Only</option>
          <option value="Pending Verification">Pending Verification</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All Categories</option>
          {categories.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.category_name}
            </option>
          ))}
        </select>

        <select
          value={allocationFilter}
          onChange={(e) => setAllocationFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All Allocations</option>
          <option value="GENERAL">General Inventory</option>
          <option value="CR_BUILDING">CR Building Allocated</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        >
          <option value="ALL">All Statuses</option>
          {ROOM_STATUS_OPTIONS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </div>

      {/* Status Colour Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 px-1">
        {ROOM_STATUS_OPTIONS.map((st) => {
          const style = STATUS_CARD_STYLES[st];
          return (
            <div key={st} className="inline-flex items-center gap-1.5">
              <span className={`w-3.5 h-3.5 rounded border ${style.card}`} />
              <span>{style.label}</span>
            </div>
          );
        })}
      </div>

      {/* Interactive Room Cards Grid */}
      {filteredRooms.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          No rooms match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredRooms.map((room) => {
            const st = STATUS_CARD_STYLES[room.status] || STATUS_CARD_STYLES.AVAILABLE;
            return (
              <button
                key={room.room_id}
                type="button"
                onClick={() => openRoomDetail(room)}
                className={`text-left border rounded-xl p-4 transition-colors cursor-pointer ${st.card}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                      Room {room.room_number}
                    </div>
                    <div className="text-xs text-slate-600">{room.floor_name}</div>
                  </div>
                  <span className={`text-xs font-semibold ${st.badgeText}`}>
                    {st.label}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-black/10 space-y-1 text-xs text-slate-700">
                  <div className="font-medium text-slate-900">{room.category_name}</div>
                  <div>
                    {room.bed_type} · {room.ac_type} · Cap {room.capacity}
                  </div>
                  <div className="flex items-center gap-1 text-slate-600">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {room.building_allocation === 'CR_BUILDING'
                        ? 'CR Building Allocation'
                        : 'General Inventory'}
                    </span>
                  </div>
                  {room.verification_status === 'PENDING_VERIFICATION' && (
                    <div className="text-amber-900 font-semibold pt-1">
                      Pending Verification
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Room Detail & Edit Modal */}
      {activeRoom && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Room {activeRoom.room_number} · {activeRoom.floor_name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {activeRoom.room_id} · {activeRoom.category_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveRoom(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isEditingRoom ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Category</div>
                    <div className="font-medium text-slate-900">{activeRoom.category_name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">AC / Non-AC</div>
                    <div className="font-medium text-slate-900">{activeRoom.ac_type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Bed Type &amp; Capacity</div>
                    <div className="font-medium text-slate-900">
                      {activeRoom.bed_type} ({activeRoom.capacity})
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Building Allocation</div>
                    <div className="font-medium text-slate-900">
                      {activeRoom.building_allocation === 'CR_BUILDING'
                        ? 'CR Building (Locked)'
                        : 'General Inventory'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Current Status</div>
                    <div className="font-semibold text-slate-900">{activeRoom.status}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Verification</div>
                    <div className="font-medium text-slate-900">
                      {activeRoom.verification_status === 'PENDING_VERIFICATION'
                        ? 'Pending Verification'
                        : 'Verified'}
                    </div>
                  </div>
                </div>

                {activeRoom.remarks && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Remarks: </span>
                    {activeRoom.remarks}
                  </div>
                )}

                {/* Quick Status Switcher */}
                <div className="border-t border-slate-200 pt-4">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    Quick Status Update
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ROOM_STATUS_OPTIONS.map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={savingRoom || activeRoom.status === st}
                        onClick={() => void handleQuickStatusUpdate(st)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border cursor-pointer disabled:opacity-50 ${
                          activeRoom.status === st
                            ? 'bg-[#0F2942] text-white border-[#0F2942]'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Confirm Retire / Delete */}
                {confirmDeleteMode !== 'NONE' && (
                  <div className="p-4 rounded-lg bg-red-50 border border-red-200 space-y-3">
                    <div className="text-sm font-semibold text-red-900">
                      Confirm Room Deactivation / Deletion
                    </div>
                    <p className="text-xs text-red-800">
                      If booking history exists for Room {activeRoom.room_number}, it will be
                      marked <strong>INACTIVE</strong> so historical booking records remain intact.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingRoom}
                        onClick={() => void handleDeleteConfirm(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer"
                      >
                        Mark Inactive (Preserve History)
                      </button>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          disabled={savingRoom}
                          onClick={() => void handleDeleteConfirm(true)}
                          className="px-3 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-300 hover:bg-red-100 rounded-lg cursor-pointer"
                        >
                          Permanent Delete (If No History)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMode('NONE')}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteMode('RETIRE')}
                    className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Retire / Delete Room
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingRoom(true)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit Room Details
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <RoomFormFields
                  floors={sortedFloors}
                  categories={categories}
                  roomNumber={formRoomNumber}
                  setRoomNumber={setFormRoomNumber}
                  floorId={formFloorId}
                  setFloorId={setFormFloorId}
                  categoryId={formCategoryId}
                  onCategoryChange={handleCategorySelectionChange}
                  bedType={formBedType}
                  setBedType={setFormBedType}
                  acType={formAcType}
                  setAcType={setFormAcType}
                  capacity={formCapacity}
                  setCapacity={setFormCapacity}
                  allocation={formAllocation}
                  onAllocationChange={handleAllocationFormChange}
                  status={formStatus}
                  setStatus={setFormStatus}
                  verification={formVerification}
                  setVerification={setFormVerification}
                  remarks={formRemarks}
                  setRemarks={setFormRemarks}
                />
                <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setIsEditingRoom(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingRoom}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg disabled:opacity-60 cursor-pointer"
                  >
                    {savingRoom ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Add New Room</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <RoomFormFields
                floors={sortedFloors}
                categories={categories}
                roomNumber={formRoomNumber}
                setRoomNumber={setFormRoomNumber}
                floorId={formFloorId}
                setFloorId={setFormFloorId}
                categoryId={formCategoryId}
                onCategoryChange={handleCategorySelectionChange}
                bedType={formBedType}
                setBedType={setFormBedType}
                acType={formAcType}
                setAcType={setFormAcType}
                capacity={formCapacity}
                setCapacity={setFormCapacity}
                allocation={formAllocation}
                onAllocationChange={handleAllocationFormChange}
                status={formStatus}
                setStatus={setFormStatus}
                verification={formVerification}
                setVerification={setFormVerification}
                remarks={formRemarks}
                setRemarks={setFormRemarks}
              />
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRoom}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {savingRoom ? 'Adding Room...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Bulk Import Rooms (CSV / Excel)</h3>
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview([]);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Upload a `.csv` or `.xlsx` file. Existing room numbers are automatically skipped to
              prevent duplicate entries.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => void handleImportFileChange(e)}
                className="text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="text-xs text-[#0F2942] font-medium underline cursor-pointer"
              >
                Download CSV Template
              </button>
            </div>

            {importPreview.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-xs space-y-1 max-h-48 overflow-y-auto">
                <div className="font-semibold text-slate-900">
                  Ready to import {importPreview.length} room(s):
                </div>
                {importPreview.slice(0, 15).map((r, i) => (
                  <div key={i} className="text-slate-600 font-mono">
                    Room {r.room_number} · {r.floor_name} · {r.category_name} · {r.ac_type}
                  </div>
                ))}
                {importPreview.length > 15 && (
                  <div className="text-slate-500">...and {importPreview.length - 15} more</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview([]);
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || importPreview.length === 0}
                onClick={() => void handleConfirmImport()}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {importing ? 'Importing...' : 'Import Rooms'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RoomFormFieldsProps {
  floors: Floor[];
  categories: RoomCategory[];
  roomNumber: string;
  setRoomNumber: (val: string) => void;
  floorId: string;
  setFloorId: (val: string) => void;
  categoryId: string;
  onCategoryChange: (val: string) => void;
  bedType: BedType;
  setBedType: (val: BedType) => void;
  acType: AcType;
  setAcType: (val: AcType) => void;
  capacity: number;
  setCapacity: (val: number) => void;
  allocation: BuildingAllocation;
  onAllocationChange: (val: BuildingAllocation) => void;
  status: RoomStatus;
  setStatus: (val: RoomStatus) => void;
  verification: 'VERIFIED' | 'PENDING_VERIFICATION';
  setVerification: (val: 'VERIFIED' | 'PENDING_VERIFICATION') => void;
  remarks: string;
  setRemarks: (val: string) => void;
}

function RoomFormFields(props: RoomFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Room Number *</label>
        <input
          type="text"
          required
          value={props.roomNumber}
          onChange={(e) => props.setRoomNumber(e.target.value)}
          placeholder="e.g. 411"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Floor *</label>
        <select
          value={props.floorId}
          onChange={(e) => props.setFloorId(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          {props.floors.map((f) => (
            <option key={f.floor_id} value={f.floor_id}>
              {f.floor_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Room Category *</label>
        <select
          value={props.categoryId}
          onChange={(e) => props.onCategoryChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          {props.categories.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.category_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">AC / Non-AC *</label>
        <select
          value={props.acType}
          onChange={(e) => props.setAcType(e.target.value as AcType)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          <option value="AC">AC</option>
          <option value="Non-AC">Non-AC</option>
          <option value="Pending Verification">Pending Verification</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Bed Type *</label>
        <select
          value={props.bedType}
          onChange={(e) => props.setBedType(e.target.value as BedType)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          <option value="Single">Single</option>
          <option value="Double">Double</option>
          <option value="Queen Size">Queen Size</option>
          <option value="VIP">VIP</option>
          <option value="Pending Verification">Pending Verification</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Capacity *</label>
        <input
          type="number"
          min={1}
          max={10}
          required
          value={props.capacity}
          onChange={(e) => props.setCapacity(Math.max(1, Number(e.target.value)))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Building Allocation *
        </label>
        <select
          value={props.allocation}
          onChange={(e) => props.onAllocationChange(e.target.value as BuildingAllocation)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          <option value="GENERAL">General Campus Inventory</option>
          <option value="CR_BUILDING">Allocated to CR Building</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Room Status *</label>
        <select
          value={props.status}
          onChange={(e) => props.setStatus(e.target.value as RoomStatus)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          {ROOM_STATUS_OPTIONS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Verification Status
        </label>
        <select
          value={props.verification}
          onChange={(e) =>
            props.setVerification(e.target.value as 'VERIFIED' | 'PENDING_VERIFICATION')
          }
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
        >
          <option value="VERIFIED">Verified</option>
          <option value="PENDING_VERIFICATION">Pending Verification</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-700 mb-1">Remarks</label>
        <textarea
          rows={2}
          value={props.remarks}
          onChange={(e) => props.setRemarks(e.target.value)}
          placeholder="Optional notes (e.g., converted from AC to Non-AC, maintenance detail)"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
        />
      </div>
    </div>
  );
}

import {deleteApp, initializeApp} from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {auth, db, SUPER_ADMIN_EMAIL} from '../firebase.ts';
import type {
  AcType,
  AdminUser,
  Announcement,
  AuditLog,
  BedType,
  Booking,
  BookingStatus,
  BuildingAllocation,
  Floor,
  Room,
  RoomAllocation,
  RoomCategory,
  RoomStatus,
  SiteSettingsDoc,
} from '../types/database.ts';
import {handleFirestoreError, OperationType} from './firestoreError.ts';
import {
  DEFAULT_SITE_SETTINGS,
  INITIAL_CATEGORIES,
  INITIAL_FLOORS,
  seedFirestoreDatabaseIfNeeded,
} from './seedFirestore.ts';

export interface PublicBootstrapData {
  fallbackMode: boolean;
  settings: SiteSettingsDoc;
  announcements: Announcement[];
  categories: RoomCategory[];
  floors: Floor[];
}

export interface PublicBookingPayload {
  applicant_name: string;
  organization: string;
  designation: string;
  email: string;
  mobile: string;
  purpose: string;
  check_in_date: string;
  check_out_date: string;
  num_persons: number;
  preferred_category: string;
  rooms_required: number;
  special_requirements: string;
  applicant_remarks: string;
}

export interface PublicBookingReceipt {
  booking_id: string;
  booking_ref: string;
  status: BookingStatus;
  created_at: string;
}

export interface AdminSnapshotData {
  rooms: Room[];
  floors: Floor[];
  categories: RoomCategory[];
  allocations: RoomAllocation[];
  bookings: Booking[];
  admins: AdminUser[];
  settings: SiteSettingsDoc;
  announcements: Announcement[];
  auditLogs: AuditLog[];
}

export type RoomAvailabilityItem = Room & {
  is_available_for_dates: boolean;
  unavailable_reason: string;
};

function tsToIso(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as {toDate: () => Date}).toDate === 'function'
  ) {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  return '';
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${rand}`;
}

function mapRoom(data: Record<string, unknown>, id: string): Room {
  return {
    room_id: String(data.room_id || id),
    room_number: String(data.room_number || ''),
    floor_id: String(data.floor_id || ''),
    floor_name: String(data.floor_name || ''),
    category_id: String(data.category_id || ''),
    category_name: String(data.category_name || ''),
    bed_type: (data.bed_type as BedType) || 'Single',
    ac_type: (data.ac_type as AcType) || 'Non-AC',
    capacity: Number(data.capacity || 1),
    building_allocation: (data.building_allocation as BuildingAllocation) || 'GENERAL',
    status: (data.status as RoomStatus) || 'AVAILABLE',
    is_active: Boolean(data.is_active ?? true),
    verification_status:
      (data.verification_status as 'VERIFIED' | 'PENDING_VERIFICATION') || 'VERIFIED',
    remarks: String(data.remarks || ''),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapFloor(data: Record<string, unknown>, id: string): Floor {
  return {
    floor_id: String(data.floor_id || id),
    floor_number: Number(data.floor_number || 1),
    floor_name: String(data.floor_name || ''),
    description: String(data.description || ''),
    display_order: Number(data.display_order || 1),
    is_active: Boolean(data.is_active ?? true),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapCategory(data: Record<string, unknown>, id: string): RoomCategory {
  return {
    category_id: String(data.category_id || id),
    category_name: String(data.category_name || ''),
    bed_type: (data.bed_type as BedType) || 'Single',
    ac_type: (data.ac_type as AcType) || 'Non-AC',
    default_capacity: Number(data.default_capacity || 1),
    description: String(data.description || ''),
    is_bookable: Boolean(data.is_bookable ?? true),
    display_order: Number(data.display_order || 1),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapAllocation(data: Record<string, unknown>, id: string): RoomAllocation {
  return {
    allocation_id: String(data.allocation_id || id),
    room_id: String(data.room_id || ''),
    room_number: String(data.room_number || ''),
    allocation_type: (data.allocation_type as BuildingAllocation) || 'GENERAL',
    allocated_to: String(data.allocated_to || ''),
    is_publicly_bookable: Boolean(data.is_publicly_bookable ?? false),
    effective_from: String(data.effective_from || ''),
    effective_to: String(data.effective_to || ''),
    remarks: String(data.remarks || ''),
    updated_by: String(data.updated_by || ''),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapBooking(data: Record<string, unknown>, id: string): Booking {
  return {
    booking_id: String(data.booking_id || id),
    booking_ref: String(data.booking_ref || ''),
    applicant_name: String(data.applicant_name || ''),
    organization: String(data.organization || ''),
    designation: String(data.designation || ''),
    email: String(data.email || ''),
    mobile: String(data.mobile || ''),
    purpose: String(data.purpose || ''),
    check_in_date: String(data.check_in_date || ''),
    check_out_date: String(data.check_out_date || ''),
    num_persons: Number(data.num_persons || 1),
    preferred_category: String(data.preferred_category || ''),
    rooms_required: Number(data.rooms_required || 1),
    assigned_room_ids: Array.isArray(data.assigned_room_ids)
      ? data.assigned_room_ids.map(String)
      : [],
    assigned_room_numbers: Array.isArray(data.assigned_room_numbers)
      ? data.assigned_room_numbers.map(String)
      : [],
    special_requirements: String(data.special_requirements || ''),
    applicant_remarks: String(data.applicant_remarks || ''),
    admin_remarks: String(data.admin_remarks || ''),
    status: (data.status as BookingStatus) || 'PENDING',
    reviewed_by: String(data.reviewed_by || ''),
    reviewed_at: String(data.reviewed_at || ''),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapAdmin(data: Record<string, unknown>, id: string): AdminUser {
  return {
    admin_id: String(data.admin_id || id),
    email: String(data.email || ''),
    full_name: String(data.full_name || ''),
    role: data.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
    is_active: Boolean(data.is_active ?? true),
    last_login_at: String(data.last_login_at || ''),
    created_by: String(data.created_by || ''),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapSettings(data: Record<string, unknown> | undefined): SiteSettingsDoc {
  if (!data) {
    return {...DEFAULT_SITE_SETTINGS, updated_at: ''};
  }
  return {
    site_title: String(data.site_title ?? DEFAULT_SITE_SETTINGS.site_title),
    site_subtitle: String(data.site_subtitle ?? DEFAULT_SITE_SETTINGS.site_subtitle),
    logo_url: String(data.logo_url ?? DEFAULT_SITE_SETTINGS.logo_url),
    hero_heading: String(data.hero_heading ?? DEFAULT_SITE_SETTINGS.hero_heading),
    hero_description: String(data.hero_description ?? DEFAULT_SITE_SETTINGS.hero_description),
    campus_address: String(data.campus_address ?? DEFAULT_SITE_SETTINGS.campus_address),
    contact_email: String(data.contact_email ?? DEFAULT_SITE_SETTINGS.contact_email),
    contact_phone: String(data.contact_phone ?? DEFAULT_SITE_SETTINGS.contact_phone),
    check_in_time: String(data.check_in_time ?? DEFAULT_SITE_SETTINGS.check_in_time),
    check_out_time: String(data.check_out_time ?? DEFAULT_SITE_SETTINGS.check_out_time),
    booking_guidelines: String(
      data.booking_guidelines ?? DEFAULT_SITE_SETTINGS.booking_guidelines,
    ),
    footer_text: String(data.footer_text ?? DEFAULT_SITE_SETTINGS.footer_text),
    show_designation:
      typeof data.show_designation === 'boolean'
        ? data.show_designation
        : DEFAULT_SITE_SETTINGS.show_designation,
    show_purpose:
      typeof data.show_purpose === 'boolean'
        ? data.show_purpose
        : DEFAULT_SITE_SETTINGS.show_purpose,
    show_special_requirements:
      typeof data.show_special_requirements === 'boolean'
        ? data.show_special_requirements
        : DEFAULT_SITE_SETTINGS.show_special_requirements,
    show_applicant_remarks:
      typeof data.show_applicant_remarks === 'boolean'
        ? data.show_applicant_remarks
        : DEFAULT_SITE_SETTINGS.show_applicant_remarks,
    updated_by: String(data.updated_by ?? SUPER_ADMIN_EMAIL),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapAnnouncement(data: Record<string, unknown>, id: string): Announcement {
  return {
    announcement_id: String(data.announcement_id || id),
    title: String(data.title || ''),
    content: String(data.content || ''),
    priority:
      (data.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT') || 'NORMAL',
    is_active: Boolean(data.is_active ?? true),
    starts_at: String(data.starts_at || ''),
    ends_at: String(data.ends_at || ''),
    created_by: String(data.created_by || ''),
    created_at: tsToIso(data.created_at),
    updated_at: tsToIso(data.updated_at),
  };
}

function mapAuditLog(data: Record<string, unknown>, id: string): AuditLog {
  return {
    log_id: String(data.log_id || id),
    actor_id: String(data.actor_id || ''),
    actor_email: String(data.actor_email || ''),
    actor_role: String(data.actor_role || ''),
    action: String(data.action || ''),
    entity_type: String(data.entity_type || ''),
    entity_id: String(data.entity_id || ''),
    details_summary: String(data.details_summary || ''),
    created_at: tsToIso(data.created_at),
  };
}

async function writeAuditLog(params: {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  detailsSummary: string;
}): Promise<void> {
  const logId = makeId('LOG');
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      log_id: logId,
      actor_id: params.actorId.slice(0, 128),
      actor_email: params.actorEmail.slice(0, 160),
      actor_role: params.actorRole.slice(0, 32),
      action: params.action.slice(0, 80),
      entity_type: params.entityType.slice(0, 64),
      entity_id: params.entityId.slice(0, 128),
      details_summary: params.detailsSummary.slice(0, 800),
      created_at: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log fallback if rule/network issue occurs
  }
}

function getFallbackCategories(): RoomCategory[] {
  return INITIAL_CATEGORIES.filter((c) => c.is_bookable).map((c) => ({
    ...c,
    created_at: '',
    updated_at: '',
  }));
}

function getFallbackFloors(): Floor[] {
  return INITIAL_FLOORS.map((f) => ({
    ...f,
    created_at: '',
    updated_at: '',
  }));
}

export async function fetchPublicBootstrap(): Promise<PublicBootstrapData> {
  try {
    const [settingsSnap, announcementsSnap, categoriesSnap, floorsSnap] =
      await Promise.all([
        getDoc(doc(db, 'settings', 'public')),
        getDocs(
          query(collection(db, 'announcements'), where('is_active', '==', true)),
        ),
        getDocs(collection(db, 'room_categories')),
        getDocs(collection(db, 'floors')),
      ]);

    const settings = mapSettings(
      settingsSnap.exists()
        ? (settingsSnap.data() as Record<string, unknown>)
        : undefined,
    );

    const announcements = announcementsSnap.docs
      .map((d) => mapAnnouncement(d.data() as Record<string, unknown>, d.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const categories = categoriesSnap.empty
      ? getFallbackCategories()
      : categoriesSnap.docs
          .map((d) => mapCategory(d.data() as Record<string, unknown>, d.id))
          .filter((c) => c.is_bookable)
          .sort((a, b) => a.display_order - b.display_order);

    const floors = floorsSnap.empty
      ? getFallbackFloors()
      : floorsSnap.docs
          .map((d) => mapFloor(d.data() as Record<string, unknown>, d.id))
          .sort((a, b) => a.display_order - b.display_order);

    return {
      fallbackMode: !settingsSnap.exists() && categoriesSnap.empty,
      settings,
      announcements,
      categories,
      floors,
    };
  } catch (err) {
    console.warn('Public bootstrap fallback used:', err);
    return {
      fallbackMode: true,
      settings: {...DEFAULT_SITE_SETTINGS, updated_at: ''},
      announcements: [],
      categories: getFallbackCategories(),
      floors: getFallbackFloors(),
    };
  }
}

export async function submitPublicBooking(
  payload: PublicBookingPayload,
): Promise<PublicBookingReceipt> {
  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomCode = Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .padEnd(6, 'X')
    .slice(0, 6);

  const bookingRef = `NADT-BLR-${todayCompact}-${randomCode}`;
  const bookingId = makeId('BKG');

  const docPayload = {
    booking_id: bookingId,
    booking_ref: bookingRef,
    applicant_name: payload.applicant_name.trim().slice(0, 120),
    organization: payload.organization.trim().slice(0, 160),
    designation: payload.designation.trim().slice(0, 120),
    email: payload.email.trim().slice(0, 160),
    mobile: payload.mobile.trim().slice(0, 30),
    purpose: (payload.purpose.trim() || 'Official Visit').slice(0, 300),
    check_in_date: payload.check_in_date,
    check_out_date: payload.check_out_date,
    num_persons: Math.max(1, Math.min(100, Math.trunc(payload.num_persons || 1))),
    preferred_category: payload.preferred_category.trim().slice(0, 100),
    rooms_required: Math.max(
      1,
      Math.min(50, Math.trunc(payload.rooms_required || 1)),
    ),
    assigned_room_ids: [] as string[],
    assigned_room_numbers: [] as string[],
    special_requirements: payload.special_requirements.trim().slice(0, 500),
    applicant_remarks: payload.applicant_remarks.trim().slice(0, 500),
    admin_remarks: '',
    status: 'PENDING' as BookingStatus,
    reviewed_by: '',
    reviewed_at: '',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'bookings', bookingId), docPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `bookings/${bookingId}`);
  }

  return {
    booking_id: bookingId,
    booking_ref: bookingRef,
    status: 'PENDING',
    created_at: new Date().toISOString(),
  };
}

export async function ensureAdminProfile(user: User): Promise<AdminUser> {
  const adminRef = doc(db, 'admins', user.uid);
  let snap;
  try {
    snap = await getDoc(adminRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `admins/${user.uid}`);
  }

  const emailLower = (user.email || '').toLowerCase();
  const isDesignatedSuperAdmin = emailLower === SUPER_ADMIN_EMAIL.toLowerCase();
  const nowIso = new Date().toISOString();

  if (!snap.exists()) {
    if (!isDesignatedSuperAdmin) {
      throw new Error(
        `Access denied for ${user.email || user.uid}. Ask the Super Admin (${SUPER_ADMIN_EMAIL}) to provision your Admin account first.`,
      );
    }

    if (!user.emailVerified) {
      throw new Error(
        `Please sign in once using "Sign in with Google (${SUPER_ADMIN_EMAIL})" to verify and initialize the Super Admin profile, or verify this email address in Firebase Authentication.`,
      );
    }

    const superProfile = {
      admin_id: user.uid,
      email: SUPER_ADMIN_EMAIL,
      full_name: user.displayName || 'NADT Bengaluru Super Admin',
      role: 'SUPER_ADMIN' as const,
      is_active: true,
      last_login_at: nowIso,
      created_by: 'SYSTEM_BOOTSTRAP',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };

    try {
      await setDoc(adminRef, superProfile);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `admins/${user.uid}`);
    }

    await seedFirestoreDatabaseIfNeeded(SUPER_ADMIN_EMAIL);

    await writeAuditLog({
      actorId: user.uid,
      actorEmail: SUPER_ADMIN_EMAIL,
      actorRole: 'SUPER_ADMIN',
      action: 'SUPER_ADMIN_INITIALIZED',
      entityType: 'ADMIN',
      entityId: user.uid,
      detailsSummary: 'Initial Super Admin profile created and authenticated.',
    });

    return {
      ...superProfile,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  const existingAdmin = mapAdmin(
    snap.data() as Record<string, unknown>,
    snap.id,
  );

  if (!existingAdmin.is_active) {
    throw new Error(
      `Administrator account (${existingAdmin.email}) is currently deactivated. Contact the Super Admin.`,
    );
  }

  try {
    await updateDoc(adminRef, {
      last_login_at: nowIso,
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `admins/${user.uid}`);
  }

  if (existingAdmin.role === 'SUPER_ADMIN') {
    await seedFirestoreDatabaseIfNeeded(existingAdmin.email);
  }

  return {
    ...existingAdmin,
    last_login_at: nowIso,
  };
}

export async function fetchAdminSnapshot(
  isSuperAdmin: boolean,
): Promise<AdminSnapshotData> {
  try {
    const [
      roomsSnap,
      floorsSnap,
      categoriesSnap,
      allocationsSnap,
      bookingsSnap,
      settingsSnap,
      announcementsSnap,
      adminsSnap,
      logsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'rooms')),
      getDocs(collection(db, 'floors')),
      getDocs(collection(db, 'room_categories')),
      getDocs(collection(db, 'room_allocations')),
      getDocs(collection(db, 'bookings')),
      getDoc(doc(db, 'settings', 'public')),
      isSuperAdmin
        ? getDocs(collection(db, 'announcements'))
        : getDocs(
            query(
              collection(db, 'announcements'),
              where('is_active', '==', true),
            ),
          ),
      isSuperAdmin ? getDocs(collection(db, 'admins')) : Promise.resolve(null),
      isSuperAdmin
        ? getDocs(
            query(
              collection(db, 'audit_logs'),
              orderBy('created_at', 'desc'),
              limit(200),
            ),
          )
        : Promise.resolve(null),
    ]);

    return {
      rooms: roomsSnap.docs
        .map((d) => mapRoom(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) =>
          a.room_number.localeCompare(b.room_number, undefined, {numeric: true}),
        ),
      floors: floorsSnap.docs
        .map((d) => mapFloor(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => a.display_order - b.display_order),
      categories: categoriesSnap.docs
        .map((d) => mapCategory(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => a.display_order - b.display_order),
      allocations: allocationsSnap.docs.map((d) =>
        mapAllocation(d.data() as Record<string, unknown>, d.id),
      ),
      bookings: bookingsSnap.docs
        .map((d) => mapBooking(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      admins: adminsSnap
        ? adminsSnap.docs
            .map((d) => mapAdmin(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => a.email.localeCompare(b.email))
        : [],
      settings: mapSettings(
        settingsSnap.exists()
          ? (settingsSnap.data() as Record<string, unknown>)
          : undefined,
      ),
      announcements: announcementsSnap.docs
        .map((d) => mapAnnouncement(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      auditLogs: logsSnap
        ? logsSnap.docs.map((d) =>
            mapAuditLog(d.data() as Record<string, unknown>, d.id),
          )
        : [],
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'admin_snapshot');
  }
}

export async function createRoomInFirestore(
  payload: Partial<Room>,
  actor: AdminUser,
): Promise<Room> {
  const roomNumber = String(payload.room_number || '').trim();
  if (!roomNumber) {
    throw new Error('Room number is required.');
  }

  const sanitizedNumber = roomNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  const roomId = `RM-${sanitizedNumber || Date.now()}`;

  try {
    const existingSnap = await getDocs(
      query(
        collection(db, 'rooms'),
        where('room_number', '==', roomNumber),
        limit(1),
      ),
    );
    if (!existingSnap.empty) {
      throw new Error(`Room ${roomNumber} already exists in inventory.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.LIST, 'rooms');
  }

  const allocation: BuildingAllocation =
    payload.building_allocation === 'CR_BUILDING' ? 'CR_BUILDING' : 'GENERAL';
  const status: RoomStatus =
    allocation === 'CR_BUILDING'
      ? 'ALLOCATED TO CR BUILDING'
      : payload.status || 'AVAILABLE';

  const newDoc = {
    room_id: roomId,
    room_number: roomNumber.slice(0, 32),
    floor_id: String(payload.floor_id || 'FL-1'),
    floor_name: String(payload.floor_name || 'First Floor').slice(0, 80),
    category_id: String(payload.category_id || 'CAT-S-NAC'),
    category_name: String(payload.category_name || 'Single Non-AC').slice(0, 100),
    bed_type: (payload.bed_type as BedType) || 'Single',
    ac_type: (payload.ac_type as AcType) || 'Non-AC',
    capacity: Math.max(1, Math.min(20, Math.trunc(Number(payload.capacity || 1)))),
    building_allocation: allocation,
    status,
    is_active: status !== 'INACTIVE',
    verification_status:
      (payload.verification_status as 'VERIFIED' | 'PENDING_VERIFICATION') ||
      'VERIFIED',
    remarks: String(payload.remarks || '').trim().slice(0, 500),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', roomId), newDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `rooms/${roomId}`);
  }

  if (allocation === 'CR_BUILDING') {
    const allocId = `ALLOC-${roomId}`;
    try {
      await setDoc(doc(db, 'room_allocations', allocId), {
        allocation_id: allocId,
        room_id: roomId,
        room_number: newDoc.room_number,
        allocation_type: 'CR_BUILDING',
        allocated_to: 'CR Building',
        is_publicly_bookable: false,
        effective_from: new Date().toISOString().slice(0, 10),
        effective_to: '',
        remarks: newDoc.remarks || 'Allocated to CR Building',
        updated_by: actor.email,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `room_allocations/${allocId}`,
      );
    }
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ROOM_CREATED',
    entityType: 'ROOM',
    entityId: roomId,
    detailsSummary: `Created Room ${newDoc.room_number} (${newDoc.category_name}, ${newDoc.floor_name}, ${newDoc.status}).`,
  });

  const nowIso = new Date().toISOString();
  return {
    ...newDoc,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function updateRoomInFirestore(
  roomId: string,
  payload: Partial<Room>,
  actor: AdminUser,
): Promise<Room> {
  const roomRef = doc(db, 'rooms', roomId);
  let snap;
  try {
    snap = await getDoc(roomRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`);
  }
  if (!snap.exists()) {
    throw new Error('Room record not found.');
  }

  const current = mapRoom(snap.data() as Record<string, unknown>, snap.id);
  const nextAllocation: BuildingAllocation =
    payload.building_allocation ?? current.building_allocation;
  const nextStatus: RoomStatus = payload.status ?? current.status;

  const updatedFields = {
    room_number: String(payload.room_number ?? current.room_number).trim().slice(0, 32),
    floor_id: String(payload.floor_id ?? current.floor_id),
    floor_name: String(payload.floor_name ?? current.floor_name).slice(0, 80),
    category_id: String(payload.category_id ?? current.category_id),
    category_name: String(payload.category_name ?? current.category_name).slice(0, 100),
    bed_type: (payload.bed_type ?? current.bed_type) as BedType,
    ac_type: (payload.ac_type ?? current.ac_type) as AcType,
    capacity: Math.max(
      1,
      Math.min(20, Math.trunc(Number(payload.capacity ?? current.capacity))),
    ),
    building_allocation: nextAllocation,
    status: nextStatus,
    is_active: nextStatus !== 'INACTIVE',
    verification_status:
      payload.verification_status ?? current.verification_status,
    remarks: String(payload.remarks ?? current.remarks).trim().slice(0, 500),
    updated_at: serverTimestamp(),
  };

  try {
    await updateDoc(roomRef, updatedFields);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }

  // Sync RoomAllocations collection if allocation changed
  const allocId = `ALLOC-${roomId}`;
  const allocRef = doc(db, 'room_allocations', allocId);
  try {
    const allocSnap = await getDoc(allocRef);
    const today = new Date().toISOString().slice(0, 10);
    if (allocSnap.exists()) {
      await updateDoc(allocRef, {
        room_number: updatedFields.room_number,
        allocation_type: nextAllocation,
        allocated_to:
          nextAllocation === 'CR_BUILDING' ? 'CR Building' : 'General Inventory',
        is_publicly_bookable: nextAllocation === 'GENERAL',
        effective_to: nextAllocation === 'GENERAL' ? today : '',
        remarks: updatedFields.remarks || '',
        updated_by: actor.email,
        updated_at: serverTimestamp(),
      });
    } else if (nextAllocation === 'CR_BUILDING') {
      await setDoc(allocRef, {
        allocation_id: allocId,
        room_id: roomId,
        room_number: updatedFields.room_number,
        allocation_type: 'CR_BUILDING',
        allocated_to: 'CR Building',
        is_publicly_bookable: false,
        effective_from: today,
        effective_to: '',
        remarks: updatedFields.remarks || 'Allocated to CR Building',
        updated_by: actor.email,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `room_allocations/${allocId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ROOM_UPDATED',
    entityType: 'ROOM',
    entityId: roomId,
    detailsSummary: `Updated Room ${updatedFields.room_number}: category=${updatedFields.category_name}, ac=${updatedFields.ac_type}, floor=${updatedFields.floor_name}, alloc=${updatedFields.building_allocation}, status=${updatedFields.status}.`,
  });

  return {
    ...current,
    ...updatedFields,
    updated_at: new Date().toISOString(),
  };
}

export async function deleteOrRetireRoomInFirestore(
  roomId: string,
  permanent: boolean,
  actor: AdminUser,
): Promise<{action: 'DEACTIVATED' | 'DELETED'; room?: Room}> {
  const roomRef = doc(db, 'rooms', roomId);
  let snap;
  try {
    snap = await getDoc(roomRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`);
  }
  if (!snap.exists()) {
    throw new Error('Room not found.');
  }
  const current = mapRoom(snap.data() as Record<string, unknown>, snap.id);

  // Check if room has booking history
  let hasHistory = false;
  try {
    const historySnap = await getDocs(
      query(
        collection(db, 'bookings'),
        where('assigned_room_ids', 'array-contains', roomId),
        limit(1),
      ),
    );
    hasHistory = !historySnap.empty;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'bookings');
  }

  if (permanent && !hasHistory && actor.role === 'SUPER_ADMIN') {
    try {
      await deleteDoc(roomRef);
      const allocRef = doc(db, 'room_allocations', `ALLOC-${roomId}`);
      const allocSnap = await getDoc(allocRef);
      if (allocSnap.exists()) {
        await deleteDoc(allocRef);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `rooms/${roomId}`);
    }

    await writeAuditLog({
      actorId: actor.admin_id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'ROOM_DELETED',
      entityType: 'ROOM',
      entityId: roomId,
      detailsSummary: `Permanently deleted Room ${current.room_number} (no historical bookings).`,
    });

    return {action: 'DELETED'};
  }

  try {
    await updateDoc(roomRef, {
      status: 'INACTIVE',
      is_active: false,
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ROOM_DEACTIVATED',
    entityType: 'ROOM',
    entityId: roomId,
    detailsSummary: `Marked Room ${current.room_number} INACTIVE${hasHistory ? ' (booking history preserved)' : ''}.`,
  });

  return {
    action: 'DEACTIVATED',
    room: {
      ...current,
      status: 'INACTIVE',
      is_active: false,
      updated_at: new Date().toISOString(),
    },
  };
}

export async function bulkImportRoomsInFirestore(
  rows: Array<Partial<Room>>,
  actor: AdminUser,
): Promise<{created: number; skipped: number; errors: string[]}> {
  let existingRooms: Room[] = [];
  try {
    const snap = await getDocs(collection(db, 'rooms'));
    existingRooms = snap.docs.map((d) =>
      mapRoom(d.data() as Record<string, unknown>, d.id),
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'rooms');
  }

  const existingNumbers = new Set(
    existingRooms.map((r) => r.room_number.trim().toLowerCase()),
  );
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const num = String(row.room_number || '').trim();
    if (!num) {
      skipped++;
      continue;
    }
    if (existingNumbers.has(num.toLowerCase())) {
      skipped++;
      errors.push(`Room ${num} already exists (skipped)`);
      continue;
    }

    try {
      await createRoomInFirestore(row, actor);
      existingNumbers.add(num.toLowerCase());
      created++;
    } catch (err) {
      skipped++;
      errors.push(
        `Room ${num}: ${err instanceof Error ? err.message : 'import error'}`,
      );
    }
  }

  return {created, skipped, errors};
}

export async function checkRoomAvailabilityInFirestore(params: {
  check_in_date: string;
  check_out_date: string;
  exclude_booking_id?: string;
}): Promise<RoomAvailabilityItem[]> {
  let roomsSnap;
  let bookingsSnap;
  try {
    [roomsSnap, bookingsSnap] = await Promise.all([
      getDocs(collection(db, 'rooms')),
      getDocs(
        query(
          collection(db, 'bookings'),
          where('status', 'in', ['APPROVED', 'CHECKED-IN']),
        ),
      ),
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'rooms_availability');
  }

  const rooms = roomsSnap.docs
    .map((d) => mapRoom(d.data() as Record<string, unknown>, d.id))
    .sort((a, b) =>
      a.room_number.localeCompare(b.room_number, undefined, {numeric: true}),
    );

  const activeBookings = bookingsSnap.docs
    .map((d) => mapBooking(d.data() as Record<string, unknown>, d.id))
    .filter((b) => b.booking_id !== params.exclude_booking_id);

  return rooms.map((room) => {
    if (!room.is_active || room.status === 'INACTIVE') {
      return {
        ...room,
        is_available_for_dates: false,
        unavailable_reason: 'Inactive Room',
      };
    }
    if (
      room.building_allocation === 'CR_BUILDING' ||
      room.status === 'ALLOCATED TO CR BUILDING'
    ) {
      return {
        ...room,
        is_available_for_dates: false,
        unavailable_reason: 'Allocated to CR Building',
      };
    }
    if (room.status === 'UNDER MAINTENANCE') {
      return {
        ...room,
        is_available_for_dates: false,
        unavailable_reason: 'Under Maintenance',
      };
    }
    if (room.status === 'RESERVED') {
      return {
        ...room,
        is_available_for_dates: false,
        unavailable_reason: 'Reserved',
      };
    }

    const conflicting = activeBookings.find(
      (b) =>
        b.assigned_room_ids.includes(room.room_id) &&
        b.check_in_date < params.check_out_date &&
        params.check_in_date < b.check_out_date,
    );

    if (conflicting) {
      return {
        ...room,
        is_available_for_dates: false,
        unavailable_reason: `Booked (${conflicting.booking_ref})`,
      };
    }

    return {
      ...room,
      is_available_for_dates: true,
      unavailable_reason: '',
    };
  });
}

export async function updateBookingInFirestore(
  bookingId: string,
  payload: Partial<Booking>,
  actor: AdminUser,
): Promise<Booking> {
  const bookingRef = doc(db, 'bookings', bookingId);
  let snap;
  try {
    snap = await getDoc(bookingRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `bookings/${bookingId}`);
  }
  if (!snap.exists()) {
    throw new Error('Booking record not found.');
  }

  const current = mapBooking(snap.data() as Record<string, unknown>, snap.id);
  const nextStatus: BookingStatus = payload.status ?? current.status;
  const nextCheckIn = payload.check_in_date ?? current.check_in_date;
  const nextCheckOut = payload.check_out_date ?? current.check_out_date;
  const nextRoomIds = payload.assigned_room_ids ?? current.assigned_room_ids;

  if (nextCheckIn >= nextCheckOut) {
    throw new Error('Check-out date must be after check-in date.');
  }

  // Re-verify date overlaps & room eligibility before approving or checking in
  const assignedRoomNumbers: string[] = [];
  if (nextRoomIds.length > 0) {
    const availability = await checkRoomAvailabilityInFirestore({
      check_in_date: nextCheckIn,
      check_out_date: nextCheckOut,
      exclude_booking_id: bookingId,
    });
    const availMap = new Map(availability.map((r) => [r.room_id, r]));

    for (const rid of nextRoomIds) {
      const rm = availMap.get(rid);
      if (!rm) {
        throw new Error(`Selected room (${rid}) no longer exists.`);
      }
      if (
        (nextStatus === 'APPROVED' || nextStatus === 'CHECKED-IN') &&
        !rm.is_available_for_dates
      ) {
        throw new Error(
          `Room ${rm.room_number} cannot be allotted: ${rm.unavailable_reason}.`,
        );
      }
      assignedRoomNumbers.push(rm.room_number);
    }
  } else if (nextStatus === 'APPROVED' || nextStatus === 'CHECKED-IN') {
    throw new Error(
      'Select at least one available room before approving or checking in.',
    );
  }

  const nowIso = new Date().toISOString();
  const isReviewTransition = nextStatus !== 'PENDING';

  const updateFields = {
    applicant_name: (payload.applicant_name ?? current.applicant_name).trim().slice(0, 120),
    organization: (payload.organization ?? current.organization).trim().slice(0, 160),
    designation: (payload.designation ?? current.designation).trim().slice(0, 120),
    email: (payload.email ?? current.email).trim().slice(0, 160),
    mobile: (payload.mobile ?? current.mobile).trim().slice(0, 30),
    purpose: (payload.purpose ?? current.purpose).trim().slice(0, 300),
    check_in_date: nextCheckIn,
    check_out_date: nextCheckOut,
    num_persons: Math.max(
      1,
      Math.min(100, Math.trunc(Number(payload.num_persons ?? current.num_persons))),
    ),
    preferred_category: payload.preferred_category ?? current.preferred_category,
    rooms_required: Math.max(
      1,
      Math.min(
        50,
        Math.trunc(Number(payload.rooms_required ?? current.rooms_required)),
      ),
    ),
    assigned_room_ids:
      nextStatus === 'REJECTED' || nextStatus === 'CANCELLED'
        ? []
        : nextRoomIds,
    assigned_room_numbers:
      nextStatus === 'REJECTED' || nextStatus === 'CANCELLED'
        ? []
        : assignedRoomNumbers,
    special_requirements: (
      payload.special_requirements ?? current.special_requirements
    )
      .trim()
      .slice(0, 500),
    applicant_remarks: (payload.applicant_remarks ?? current.applicant_remarks)
      .trim()
      .slice(0, 500),
    admin_remarks: (payload.admin_remarks ?? current.admin_remarks)
      .trim()
      .slice(0, 500),
    status: nextStatus,
    reviewed_by: isReviewTransition ? actor.email : current.reviewed_by,
    reviewed_at: isReviewTransition ? nowIso : current.reviewed_at,
    updated_at: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.update(bookingRef, updateFields);

    // Sync assigned rooms' statuses cleanly
    const previousIds = new Set(current.assigned_room_ids);
    const nextIdsSet = new Set(updateFields.assigned_room_ids);

    // Release rooms removed from booking or when booking becomes REJECTED/CANCELLED/CHECKED-OUT
    for (const prevId of previousIds) {
      if (
        !nextIdsSet.has(prevId) ||
        nextStatus === 'REJECTED' ||
        nextStatus === 'CANCELLED' ||
        nextStatus === 'CHECKED-OUT'
      ) {
        const rmSnap = await getDoc(doc(db, 'rooms', prevId));
        if (rmSnap.exists()) {
          const rm = mapRoom(rmSnap.data() as Record<string, unknown>, rmSnap.id);
          if (
            rm.building_allocation !== 'CR_BUILDING' &&
            (rm.status === 'BOOKED' || rm.status === 'OCCUPIED')
          ) {
            batch.update(doc(db, 'rooms', prevId), {
              status: 'AVAILABLE',
              updated_at: serverTimestamp(),
            });
          }
        }
      }
    }

    // Update newly/currently assigned rooms for APPROVED or CHECKED-IN
    if (nextStatus === 'APPROVED' || nextStatus === 'CHECKED-IN') {
      const targetRoomStatus: RoomStatus =
        nextStatus === 'CHECKED-IN' ? 'OCCUPIED' : 'BOOKED';
      for (const rid of updateFields.assigned_room_ids) {
        batch.update(doc(db, 'rooms', rid), {
          status: targetRoomStatus,
          updated_at: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `bookings/${bookingId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: `BOOKING_${nextStatus.replace(/-/g, '_')}`,
    entityType: 'BOOKING',
    entityId: bookingId,
    detailsSummary: `${current.booking_ref} -> ${nextStatus}. Rooms: ${updateFields.assigned_room_numbers.join(', ') || 'None'}.`,
  });

  return {
    ...current,
    ...updateFields,
    updated_at: nowIso,
  };
}

export async function fetchAdminsInFirestore(): Promise<AdminUser[]> {
  try {
    const snap = await getDocs(collection(db, 'admins'));
    return snap.docs
      .map((d) => mapAdmin(d.data() as Record<string, unknown>, d.id))
      .sort((a, b) => a.email.localeCompare(b.email));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'admins');
  }
}

export async function createStandardAdminAccount(
  input: {email: string; full_name: string; password: string},
  actor: AdminUser,
): Promise<AdminUser> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.full_name.trim();
  if (!email || !fullName || input.password.length < 8) {
    throw new Error(
      'Valid email, full name, and password (minimum 8 characters) are required.',
    );
  }
  if (email === SUPER_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('Cannot create duplicate Super Admin account.');
  }

  // Use a secondary Firebase App instance so creating the new user
  // does not sign out the active Super Admin session.
  const secondaryApp = initializeApp(firebaseConfig, `AdminProvision-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let newUid = '';

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      input.password,
    );
    newUid = credential.user.uid;
    await signOut(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }

  const nowIso = new Date().toISOString();
  const profileData = {
    admin_id: newUid,
    email,
    full_name: fullName.slice(0, 120),
    role: 'ADMIN' as const,
    is_active: true,
    last_login_at: '',
    created_by: actor.email,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'admins', newUid), profileData);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `admins/${newUid}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ADMIN_CREATED',
    entityType: 'ADMIN',
    entityId: newUid,
    detailsSummary: `Provisioned standard ADMIN account for ${email} (${fullName}).`,
  });

  return {
    ...profileData,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function toggleAdminActiveStatusInFirestore(
  target: AdminUser,
  actor: AdminUser,
): Promise<AdminUser> {
  if (target.role === 'SUPER_ADMIN') {
    throw new Error('Super Admin account cannot be deactivated.');
  }
  const nextActive = !target.is_active;
  try {
    await updateDoc(doc(db, 'admins', target.admin_id), {
      is_active: nextActive,
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `admins/${target.admin_id}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: nextActive ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED',
    entityType: 'ADMIN',
    entityId: target.admin_id,
    detailsSummary: `${target.email} set to ${nextActive ? 'ACTIVE' : 'INACTIVE'}.`,
  });

  return {
    ...target,
    is_active: nextActive,
    updated_at: new Date().toISOString(),
  };
}

export async function sendAdminPasswordResetEmail(
  target: AdminUser,
  actor: AdminUser,
): Promise<void> {
  await sendPasswordResetEmail(auth, target.email);
  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ADMIN_PASSWORD_RESET_SENT',
    entityType: 'ADMIN',
    entityId: target.admin_id,
    detailsSummary: `Sent Firebase password reset email to ${target.email}.`,
  });
}

export async function changeOrLinkOwnPassword(params: {
  currentPassword?: string;
  newPassword: string;
}): Promise<'LINKED' | 'UPDATED'> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('No authenticated user session.');
  }

  const hasPasswordProvider = user.providerData.some(
    (p) => p.providerId === 'password',
  );

  if (!hasPasswordProvider) {
    const credential = EmailAuthProvider.credential(
      user.email,
      params.newPassword,
    );
    await linkWithCredential(user, credential);
    return 'LINKED';
  }

  if (!params.currentPassword) {
    throw new Error('Enter your current password to confirm the update.');
  }
  const credential = EmailAuthProvider.credential(
    user.email,
    params.currentPassword,
  );
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, params.newPassword);
  return 'UPDATED';
}

export async function fetchAuditLogsInFirestore(
  maxLogs = 200,
): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'audit_logs'),
        orderBy('created_at', 'desc'),
        limit(maxLogs),
      ),
    );
    return snap.docs.map((d) =>
      mapAuditLog(d.data() as Record<string, unknown>, d.id),
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'audit_logs');
  }
}

export async function savePublicSiteSettings(
  next: Omit<SiteSettingsDoc, 'updated_by' | 'updated_at'>,
  actor: AdminUser,
): Promise<SiteSettingsDoc> {
  const docData = {
    site_title: next.site_title.slice(0, 140),
    site_subtitle: next.site_subtitle.slice(0, 180),
    logo_url: next.logo_url.slice(0, 120000),
    hero_heading: next.hero_heading.slice(0, 200),
    hero_description: next.hero_description.slice(0, 800),
    campus_address: next.campus_address.slice(0, 300),
    contact_email: next.contact_email.slice(0, 160),
    contact_phone: next.contact_phone.slice(0, 60),
    check_in_time: next.check_in_time.slice(0, 40),
    check_out_time: next.check_out_time.slice(0, 40),
    booking_guidelines: next.booking_guidelines.slice(0, 1000),
    footer_text: next.footer_text.slice(0, 200),
    show_designation: Boolean(next.show_designation),
    show_purpose: Boolean(next.show_purpose),
    show_special_requirements: Boolean(next.show_special_requirements),
    show_applicant_remarks: Boolean(next.show_applicant_remarks),
    updated_by: actor.email,
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'settings', 'public'), docData);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/public');
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'CMS_SETTINGS_UPDATED',
    entityType: 'SETTINGS',
    entityId: 'public',
    detailsSummary: 'Updated public portal settings, branding, and form fields.',
  });

  return {
    ...docData,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertAnnouncementInFirestore(
  payload: Partial<Announcement>,
  actor: AdminUser,
): Promise<void> {
  const annId = payload.announcement_id || makeId('ANN');
  const annRef = doc(db, 'announcements', annId);

  try {
    const snap = await getDoc(annRef);
    if (snap.exists()) {
      const current = mapAnnouncement(
        snap.data() as Record<string, unknown>,
        snap.id,
      );
      await updateDoc(annRef, {
        title: String(payload.title ?? current.title).trim().slice(0, 140),
        content: String(payload.content ?? current.content).trim().slice(0, 800),
        priority: payload.priority ?? current.priority,
        is_active: payload.is_active ?? current.is_active,
        starts_at: String(payload.starts_at ?? current.starts_at).slice(0, 64),
        ends_at: String(payload.ends_at ?? current.ends_at).slice(0, 64),
        updated_at: serverTimestamp(),
      });
    } else {
      await setDoc(annRef, {
        announcement_id: annId,
        title: String(payload.title || 'Campus Notice').trim().slice(0, 140),
        content: String(payload.content || '').trim().slice(0, 800),
        priority: payload.priority || 'NORMAL',
        is_active: payload.is_active ?? true,
        starts_at: String(payload.starts_at || '').slice(0, 64),
        ends_at: String(payload.ends_at || '').slice(0, 64),
        created_by: actor.email,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `announcements/${annId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ANNOUNCEMENT_SAVED',
    entityType: 'ANNOUNCEMENT',
    entityId: annId,
    detailsSummary: `Saved announcement "${String(payload.title || annId)}".`,
  });
}

export async function deleteAnnouncementInFirestore(
  annId: string,
  actor: AdminUser,
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', annId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `announcements/${annId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'ANNOUNCEMENT_DELETED',
    entityType: 'ANNOUNCEMENT',
    entityId: annId,
    detailsSummary: `Deleted announcement ${annId}.`,
  });
}

export async function upsertCategoryInFirestore(
  payload: Partial<RoomCategory>,
  actor: AdminUser,
): Promise<void> {
  const catId = payload.category_id || makeId('CAT');
  const catRef = doc(db, 'room_categories', catId);

  try {
    const snap = await getDoc(catRef);
    if (snap.exists()) {
      const current = mapCategory(
        snap.data() as Record<string, unknown>,
        snap.id,
      );
      await updateDoc(catRef, {
        category_name: String(
          payload.category_name ?? current.category_name,
        )
          .trim()
          .slice(0, 100),
        bed_type: payload.bed_type ?? current.bed_type,
        ac_type: payload.ac_type ?? current.ac_type,
        default_capacity: Math.max(
          1,
          Math.min(
            20,
            Math.trunc(
              Number(payload.default_capacity ?? current.default_capacity),
            ),
          ),
        ),
        description: String(payload.description ?? current.description)
          .trim()
          .slice(0, 300),
        is_bookable: payload.is_bookable ?? current.is_bookable,
        display_order: Math.max(
          0,
          Math.min(
            100,
            Math.trunc(Number(payload.display_order ?? current.display_order)),
          ),
        ),
        updated_at: serverTimestamp(),
      });
    } else {
      await setDoc(catRef, {
        category_id: catId,
        category_name: String(payload.category_name || 'New Category')
          .trim()
          .slice(0, 100),
        bed_type: payload.bed_type || 'Single',
        ac_type: payload.ac_type || 'AC',
        default_capacity: Math.max(
          1,
          Math.min(20, Math.trunc(Number(payload.default_capacity || 1))),
        ),
        description: String(payload.description || '').trim().slice(0, 300),
        is_bookable: payload.is_bookable ?? true,
        display_order: Math.max(
          0,
          Math.min(100, Math.trunc(Number(payload.display_order || 10))),
        ),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `room_categories/${catId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'CATEGORY_SAVED',
    entityType: 'CATEGORY',
    entityId: catId,
    detailsSummary: `Saved room category "${String(payload.category_name || catId)}".`,
  });
}

export async function updateFloorInFirestore(
  floorId: string,
  payload: Partial<Floor>,
  actor: AdminUser,
): Promise<void> {
  const floorRef = doc(db, 'floors', floorId);
  try {
    const snap = await getDoc(floorRef);
    if (!snap.exists()) {
      throw new Error('Floor record not found.');
    }
    const current = mapFloor(snap.data() as Record<string, unknown>, snap.id);
    await updateDoc(floorRef, {
      floor_number: Math.trunc(
        Number(payload.floor_number ?? current.floor_number),
      ),
      floor_name: String(payload.floor_name ?? current.floor_name)
        .trim()
        .slice(0, 80),
      description: String(payload.description ?? current.description)
        .trim()
        .slice(0, 300),
      display_order: Math.trunc(
        Number(payload.display_order ?? current.display_order),
      ),
      is_active: payload.is_active ?? current.is_active,
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `floors/${floorId}`);
  }

  await writeAuditLog({
    actorId: actor.admin_id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'FLOOR_UPDATED',
    entityType: 'FLOOR',
    entityId: floorId,
    detailsSummary: `Updated floor ${floorId} (${String(payload.floor_name || '')}).`,
  });
}

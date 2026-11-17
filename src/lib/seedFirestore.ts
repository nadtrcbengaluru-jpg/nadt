import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {db, SUPER_ADMIN_EMAIL} from '../firebase.ts';
import type {
  AcType,
  BedType,
  BuildingAllocation,
  RoomStatus,
} from '../types/database.ts';
import {handleFirestoreError, OperationType} from './firestoreError.ts';

export const DEFAULT_SITE_SETTINGS = {
  site_title: 'NADT Regional Campus, Bengaluru',
  site_subtitle: 'Hostel & Guest House Room Booking Portal',
  logo_url: '',
  hero_heading: 'Official Accommodation & Room Request Portal',
  hero_description:
    'Submit official accommodation requests for training programmes, conferences, and institutional visits at NADT Regional Campus, Bengaluru. No sign-in or applicant account is required.',
  campus_address:
    'National Academy of Direct Taxes Regional Campus, Bengaluru, Karnataka',
  contact_email: 'nadtrc.bengaluru@gmail.com',
  contact_phone: '+91-80-0000-0000',
  check_in_time: '12:00 PM',
  check_out_time: '11:00 AM',
  booking_guidelines:
    'All booking requests remain PENDING until approved by an authorized Campus Administrator. CR Building allocated rooms are reserved and excluded from general bookings.',
  footer_text:
    'NADT Regional Campus, Bengaluru · Room Inventory & Booking Administration',
  show_designation: true,
  show_purpose: true,
  show_special_requirements: true,
  show_applicant_remarks: true,
  updated_by: SUPER_ADMIN_EMAIL,
};

export const INITIAL_FLOORS = [
  {
    floor_id: 'FL-1',
    floor_number: 1,
    floor_name: 'First Floor',
    description: '10 Single Non-AC rooms and 5 Double Non-AC rooms (15 rooms)',
    display_order: 1,
    is_active: true,
  },
  {
    floor_id: 'FL-2',
    floor_number: 2,
    floor_name: 'Second Floor',
    description: '10 Single Non-AC rooms and 6 Double Non-AC rooms (16 rooms)',
    display_order: 2,
    is_active: true,
  },
  {
    floor_id: 'FL-3',
    floor_number: 3,
    floor_name: 'Third Floor',
    description: '10 Single Non-AC rooms and 6 Double Non-AC rooms (16 rooms)',
    display_order: 3,
    is_active: true,
  },
  {
    floor_id: 'FL-4',
    floor_number: 4,
    floor_name: 'Fourth Floor',
    description:
      '10 Single AC, 4 Double AC, Room 411 Double Non-AC, and Room 416 Pending Verification (16 rooms)',
    display_order: 4,
    is_active: true,
  },
  {
    floor_id: 'FL-5',
    floor_number: 5,
    floor_name: 'Fifth Floor',
    description: '5 Queen Size AC rooms and 11 Double AC rooms (16 rooms)',
    display_order: 5,
    is_active: true,
  },
  {
    floor_id: 'FL-6',
    floor_number: 6,
    floor_name: 'Sixth Floor',
    description: '5 VIP AC suites (5 rooms)',
    display_order: 6,
    is_active: true,
  },
];

export const INITIAL_CATEGORIES: Array<{
  category_id: string;
  category_name: string;
  bed_type: BedType;
  ac_type: AcType;
  default_capacity: number;
  description: string;
  is_bookable: boolean;
  display_order: number;
}> = [
  {
    category_id: 'CAT-S-NAC',
    category_name: 'Single Non-AC',
    bed_type: 'Single',
    ac_type: 'Non-AC',
    default_capacity: 1,
    description: 'Single occupancy non-AC hostel room',
    is_bookable: true,
    display_order: 1,
  },
  {
    category_id: 'CAT-D-NAC',
    category_name: 'Double Non-AC',
    bed_type: 'Double',
    ac_type: 'Non-AC',
    default_capacity: 2,
    description: 'Double occupancy non-AC room',
    is_bookable: true,
    display_order: 2,
  },
  {
    category_id: 'CAT-S-AC',
    category_name: 'Single AC',
    bed_type: 'Single',
    ac_type: 'AC',
    default_capacity: 1,
    description: 'Single occupancy air-conditioned room',
    is_bookable: true,
    display_order: 3,
  },
  {
    category_id: 'CAT-D-AC',
    category_name: 'Double AC',
    bed_type: 'Double',
    ac_type: 'AC',
    default_capacity: 2,
    description: 'Double occupancy air-conditioned room',
    is_bookable: true,
    display_order: 4,
  },
  {
    category_id: 'CAT-Q-AC',
    category_name: 'Queen Size AC',
    bed_type: 'Queen Size',
    ac_type: 'AC',
    default_capacity: 2,
    description: 'Queen Size bed air-conditioned officer room',
    is_bookable: true,
    display_order: 5,
  },
  {
    category_id: 'CAT-VIP-AC',
    category_name: 'VIP AC',
    bed_type: 'VIP',
    ac_type: 'AC',
    default_capacity: 2,
    description: 'VIP air-conditioned guest suite',
    is_bookable: true,
    display_order: 6,
  },
  {
    category_id: 'CAT-UNID',
    category_name: 'Unidentified / Pending Verification',
    bed_type: 'Pending Verification',
    ac_type: 'Pending Verification',
    default_capacity: 2,
    description:
      '84th inventory verification slot pending Super Admin verification',
    is_bookable: false,
    display_order: 7,
  },
];

const CR_BUILDING_ROOMS = new Set([
  '601',
  '604',
  '605',
  '404',
  '405',
  '406',
  '407',
  '408',
  '409',
  '410',
  '511',
  '512',
  '513',
  '514',
  '515',
  '516',
  '416',
]);

interface RoomSeedSpec {
  room_id: string;
  room_number: string;
  floor_id: string;
  floor_name: string;
  category_id: string;
  category_name: string;
  bed_type: BedType;
  ac_type: AcType;
  capacity: number;
  building_allocation: BuildingAllocation;
  status: RoomStatus;
  is_active: boolean;
  verification_status: 'VERIFIED' | 'PENDING_VERIFICATION';
  remarks: string;
}

function buildInitialRooms(): RoomSeedSpec[] {
  const list: RoomSeedSpec[] = [];

  const pushRoom = (
    roomNumber: string,
    floorId: string,
    floorName: string,
    categoryId: string,
    categoryName: string,
    bedType: BedType,
    acType: AcType,
    capacity: number,
    verificationStatus: 'VERIFIED' | 'PENDING_VERIFICATION',
    remarks: string,
  ) => {
    const isCr = CR_BUILDING_ROOMS.has(roomNumber);
    list.push({
      room_id: `RM-${roomNumber}`,
      room_number: roomNumber,
      floor_id: floorId,
      floor_name: floorName,
      category_id: categoryId,
      category_name: categoryName,
      bed_type: bedType,
      ac_type: acType,
      capacity,
      building_allocation: isCr ? 'CR_BUILDING' : 'GENERAL',
      status: isCr ? 'ALLOCATED TO CR BUILDING' : 'AVAILABLE',
      is_active: true,
      verification_status: verificationStatus,
      remarks:
        remarks ||
        (isCr ? 'Initially allocated to CR Building' : ''),
    });
  };

  // First Floor: 10 Single Non-AC (101-110), 5 Double Non-AC (111-115) = 15
  for (let n = 101; n <= 110; n++) {
    pushRoom(String(n), 'FL-1', 'First Floor', 'CAT-S-NAC', 'Single Non-AC', 'Single', 'Non-AC', 1, 'VERIFIED', '');
  }
  for (let n = 111; n <= 115; n++) {
    pushRoom(String(n), 'FL-1', 'First Floor', 'CAT-D-NAC', 'Double Non-AC', 'Double', 'Non-AC', 2, 'VERIFIED', '');
  }

  // Second Floor: 10 Single Non-AC (201-210), 6 Double Non-AC (211-216) = 16
  for (let n = 201; n <= 210; n++) {
    pushRoom(String(n), 'FL-2', 'Second Floor', 'CAT-S-NAC', 'Single Non-AC', 'Single', 'Non-AC', 1, 'VERIFIED', '');
  }
  for (let n = 211; n <= 216; n++) {
    pushRoom(String(n), 'FL-2', 'Second Floor', 'CAT-D-NAC', 'Double Non-AC', 'Double', 'Non-AC', 2, 'VERIFIED', '');
  }

  // Third Floor: 10 Single Non-AC (301-310), 6 Double Non-AC (311-316) = 16
  for (let n = 301; n <= 310; n++) {
    pushRoom(String(n), 'FL-3', 'Third Floor', 'CAT-S-NAC', 'Single Non-AC', 'Single', 'Non-AC', 1, 'VERIFIED', '');
  }
  for (let n = 311; n <= 316; n++) {
    pushRoom(String(n), 'FL-3', 'Third Floor', 'CAT-D-NAC', 'Double Non-AC', 'Double', 'Non-AC', 2, 'VERIFIED', '');
  }

  // Fourth Floor: 10 Single AC (401-410), Room 411 Double Non-AC, 4 Double AC (412-415), Room 416 Unidentified/Pending Verification = 16
  for (let n = 401; n <= 410; n++) {
    pushRoom(String(n), 'FL-4', 'Fourth Floor', 'CAT-S-AC', 'Single AC', 'Single', 'AC', 1, 'VERIFIED', '');
  }
  pushRoom(
    '411',
    'FL-4',
    'Fourth Floor',
    'CAT-D-NAC',
    'Double Non-AC',
    'Double',
    'Non-AC',
    2,
    'VERIFIED',
    'Converted from Double AC to Double Non-AC',
  );
  for (let n = 412; n <= 415; n++) {
    pushRoom(String(n), 'FL-4', 'Fourth Floor', 'CAT-D-AC', 'Double AC', 'Double', 'AC', 2, 'VERIFIED', '');
  }
  pushRoom(
    '416',
    'FL-4',
    'Fourth Floor',
    'CAT-UNID',
    'Unidentified / Pending Verification',
    'Pending Verification',
    'Pending Verification',
    2,
    'PENDING_VERIFICATION',
    '84th inventory entry pending category verification (Double AC / Non-AC); allocated to CR Building',
  );

  // Fifth Floor: 5 Queen Size AC (501-505), 11 Double AC (506-516) = 16
  for (let n = 501; n <= 505; n++) {
    pushRoom(String(n), 'FL-5', 'Fifth Floor', 'CAT-Q-AC', 'Queen Size AC', 'Queen Size', 'AC', 2, 'VERIFIED', '');
  }
  for (let n = 506; n <= 516; n++) {
    pushRoom(String(n), 'FL-5', 'Fifth Floor', 'CAT-D-AC', 'Double AC', 'Double', 'AC', 2, 'VERIFIED', '');
  }

  // Sixth Floor: 5 VIP AC (601-605) = 5
  for (let n = 601; n <= 605; n++) {
    pushRoom(String(n), 'FL-6', 'Sixth Floor', 'CAT-VIP-AC', 'VIP AC', 'VIP', 'AC', 2, 'VERIFIED', '');
  }

  return list; // Exact 84 rooms
}

export async function seedFirestoreDatabaseIfNeeded(actorEmail: string): Promise<boolean> {
  try {
    const existingRooms = await getDocs(query(collection(db, 'rooms'), limit(1)));
    if (!existingRooms.empty) {
      return false;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'rooms');
  }

  const rooms = buildInitialRooms();
  const crRooms = rooms.filter((r) => r.building_allocation === 'CR_BUILDING');

  // Batch 1: Floors (6) + Categories (7) + Settings (1) + Announcement (1) + Rooms (84) = 99 ops (< 500 limit)
  try {
    const batch1 = writeBatch(db);

    for (const floor of INITIAL_FLOORS) {
      batch1.set(doc(db, 'floors', floor.floor_id), {
        ...floor,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }

    for (const cat of INITIAL_CATEGORIES) {
      batch1.set(doc(db, 'room_categories', cat.category_id), {
        ...cat,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }

    batch1.set(doc(db, 'settings', 'public'), {
      ...DEFAULT_SITE_SETTINGS,
      updated_by: actorEmail,
      updated_at: serverTimestamp(),
    });

    batch1.set(doc(db, 'announcements', 'ANN-001'), {
      announcement_id: 'ANN-001',
      title: 'Accommodation Request Policy',
      content:
        'Public room requests are accepted online without login. Room allocation is confirmed upon Campus Administration approval.',
      priority: 'NORMAL',
      is_active: true,
      starts_at: '',
      ends_at: '',
      created_by: actorEmail,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    for (const room of rooms) {
      batch1.set(doc(db, 'rooms', room.room_id), {
        ...room,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }

    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'initial_seed_batch');
  }

  // Batch 2: Room Allocations (17 CR Building rooms) + Initial Audit Log
  // Committed AFTER rooms so firestore.rules exists(/rooms/{roomId}) passes!
  try {
    const batch2 = writeBatch(db);
    const today = new Date().toISOString().slice(0, 10);

    for (const room of crRooms) {
      const allocId = `ALLOC-${room.room_id}`;
      batch2.set(doc(db, 'room_allocations', allocId), {
        allocation_id: allocId,
        room_id: room.room_id,
        room_number: room.room_number,
        allocation_type: 'CR_BUILDING',
        allocated_to: 'CR Building',
        is_publicly_bookable: false,
        effective_from: today,
        effective_to: '',
        remarks: room.remarks || 'Initially allocated to CR Building',
        updated_by: actorEmail,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }

    const logId = `LOG-SEED-${Date.now()}`;
    batch2.set(doc(db, 'audit_logs', logId), {
      log_id: logId,
      actor_id: 'system-seed',
      actor_email: actorEmail,
      actor_role: 'SUPER_ADMIN',
      action: 'DATABASE_SEEDED',
      entity_type: 'SYSTEM',
      entity_id: 'initial-84-rooms',
      details_summary:
        'Initialized 84 rooms (including Room 411 Double Non-AC, Room 416 Pending Verification, and 17 CR Building allocations), 6 floors, 7 categories, and CMS defaults.',
      created_at: serverTimestamp(),
    });

    await batch2.commit();
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'room_allocations_seed');
  }
}

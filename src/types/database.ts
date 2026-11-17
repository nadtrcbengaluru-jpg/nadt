export type RoomStatus =
  | 'AVAILABLE'
  | 'BOOKED'
  | 'OCCUPIED'
  | 'UNDER MAINTENANCE'
  | 'RESERVED'
  | 'ALLOCATED TO CR BUILDING'
  | 'INACTIVE';

export type BookingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CHECKED-IN'
  | 'CHECKED-OUT';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN';

export type BuildingAllocation = 'GENERAL' | 'CR_BUILDING';

export type AcType = 'AC' | 'Non-AC' | 'Pending Verification';

export type BedType = 'Single' | 'Double' | 'Queen Size' | 'VIP' | 'Pending Verification';

export interface Room {
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
  created_at: string;
  updated_at: string;
}

export interface Floor {
  floor_id: string;
  floor_number: number;
  floor_name: string;
  description: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomCategory {
  category_id: string;
  category_name: string;
  bed_type: BedType;
  ac_type: AcType;
  default_capacity: number;
  description: string;
  is_bookable: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoomAllocation {
  allocation_id: string;
  room_id: string;
  room_number: string;
  allocation_type: BuildingAllocation;
  allocated_to: string;
  is_publicly_bookable: boolean;
  effective_from: string;
  effective_to: string;
  remarks: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  booking_id: string;
  booking_ref: string;
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
  assigned_room_ids: string[];
  assigned_room_numbers: string[];
  special_requirements: string;
  applicant_remarks: string;
  admin_remarks: string;
  status: BookingStatus;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
  updated_at: string;
}

export interface AdminUser {
  admin_id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  last_login_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SiteSettingsDoc {
  site_title: string;
  site_subtitle: string;
  logo_url: string;
  hero_heading: string;
  hero_description: string;
  campus_address: string;
  contact_email: string;
  contact_phone: string;
  check_in_time: string;
  check_out_time: string;
  booking_guidelines: string;
  footer_text: string;
  show_designation: boolean;
  show_purpose: boolean;
  show_special_requirements: boolean;
  show_applicant_remarks: boolean;
  updated_by: string;
  updated_at: string;
}

export interface Announcement {
  announcement_id: string;
  title: string;
  content: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  log_id: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details_summary: string;
  created_at: string;
}

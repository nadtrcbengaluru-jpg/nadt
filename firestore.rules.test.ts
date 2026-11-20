/**
 * Payload-First Security TDD specification verifying that all Dirty Dozen
 * adversarial payloads are blocked by firestore.rules.
 * Designed for execution with @firebase/rules-unit-testing against Firestore Emulator.
 */

export const DIRTY_DOZEN_EXPECTATIONS = [
  { id: 1, name: 'Unauthenticated booking with status=APPROVED', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unauthenticated list on bookings', collection: 'bookings', op: 'list', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Shadow field injection on booking create', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Unverified email spoofing nadtrc.bengaluru@gmail.com', collection: 'admins', op: 'list', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Standard Admin self-promoting to SUPER_ADMIN', collection: 'admins', op: 'update', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Deactivated Admin updating room status', collection: 'rooms', op: 'update', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Oversized/invalid document ID injection', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Client-forged created_at timestamp instead of request.time', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Modifying or deleting immutable audit_logs', collection: 'audit_logs', op: 'delete', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Standard Admin permanently deleting a room', collection: 'rooms', op: 'delete', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Standard Admin modifying CMS settings/public', collection: 'settings', op: 'update', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Unauthenticated unfiltered list on announcements', collection: 'announcements', op: 'list', expected: 'PERMISSION_DENIED' },
  { id: 13, name: 'Unauthenticated or orphaned room maintenance schedule create', collection: 'maintenance_schedules', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 14, name: 'Unauthenticated list/enumeration on booking_status_cards', collection: 'booking_status_cards', op: 'list', expected: 'PERMISSION_DENIED' },
  { id: 15, name: 'Orphaned or pre-approved public booking_status_cards create/update', collection: 'booking_status_cards', op: 'create', expected: 'PERMISSION_DENIED' },
] as const;



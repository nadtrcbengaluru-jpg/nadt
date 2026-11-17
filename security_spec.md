# Security Specification & TDD Plan (Firestore Rules)

## 1. Data Invariants
1. **Default Deny:** All unspecified Firestore paths are denied by default (`/{document=**}`).
2. **Public Booking Isolation:** Unauthenticated visitors may ONLY `create` a `bookings/{bookingId}` document with `status == 'PENDING'`, empty `assigned_room_ids`, empty `assigned_room_numbers`, empty `admin_remarks`, empty `reviewed_by`, and server timestamps (`request.time`). Unauthenticated visitors cannot `get`, `list`, `update`, or `delete` any booking.
3. **Role Authority:** Only a verified Super Admin (`request.auth.token.email == 'nadtrc.bengaluru@gmail.com' && request.auth.token.email_verified == true` OR active `SUPER_ADMIN` document in `/admins/{uid}`) may create/edit/deactivate `/admins/{uid}`, update `/settings/*`, manage `/announcements/*`, manage `/floors/*`, manage `/room_categories/*`, permanently delete `/rooms/*`, or read `/audit_logs/*`.
4. **No Self-Privilege Escalation:** Standard `ADMIN` users cannot write to `/admins/*` or promote themselves to `SUPER_ADMIN`, and deactivated admins (`is_active == false`) lose access synchronously.
5. **Immutable Audit Trail:** `/audit_logs/{logId}` documents are append-only (`create` by active Admin/Super Admin, `update` and `delete` strictly forbidden).
6. **Strict Schema & Bounds:** Every collection enforces exact `keys().hasAll(...)` and `keys().hasOnly(...)` allowlists, type checks, string `.size()` bounds, integer range checks, and `isValidId()` regex validation on document IDs.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Booking Approval:** Public client creates `/bookings/BK-ATK1` with `status: 'APPROVED'` and `assigned_room_ids: ['RM-001']`. -> **REJECTED**
2. **Public Booking Scraping:** Unauthenticated client runs `list` or `get` on `/bookings`. -> **REJECTED**
3. **Shadow / Ghost Field Injection:** Public client creates `/bookings/BK-ATK2` including extra field `is_vip_override: true`. -> **REJECTED**
4. **Email Spoofing Attack:** User signs in with `email: 'nadtrc.bengaluru@gmail.com'` and `email_verified: false` and tries to read `/admins` or `/bookings`. -> **REJECTED**
5. **Self-Promotion Attack:** Standard `ADMIN` updates `/admins/{ownUid}` changing `role` to `'SUPER_ADMIN'`. -> **REJECTED**
6. **Deactivated Admin Access:** Admin with `/admins/{uid}.is_active == false` tries to update `/rooms/RM-001`. -> **REJECTED**
7. **ID Poisoning / DoW:** Client attempts to create `/bookings/<1500-char-invalid-id>` or inject a 1MB `remarks` string. -> **REJECTED**
8. **Timestamp Forgery:** Client creates a booking with a client-supplied past `created_at` instead of `request.time`. -> **REJECTED**
9. **Audit Log Tampering:** Even a `SUPER_ADMIN` tries to `update` or `delete` `/audit_logs/LOG-001`. -> **REJECTED**
10. **Standard Admin Deleting Room Permanently:** Standard `ADMIN` tries `delete` on `/rooms/RM-001`. -> **REJECTED**
11. **Standard Admin Editing CMS Settings:** Standard `ADMIN` tries to overwrite `/settings/public`. -> **REJECTED**
12. **Hidden Announcement Scraping:** Public visitor runs `list` on `/announcements` without filtering `is_active == true`. -> **REJECTED**

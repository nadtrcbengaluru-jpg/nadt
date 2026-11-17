# Firebase & Vercel Deployment Guide — NADT Regional Campus, Bengaluru

## 1. Firebase Configuration & Security Rules
- Firebase project: `semiotic-pact-423605-b6`
- Firestore database: `ai-studio-nadtregionalcamp-76016eef-ba24-4c89-88d5-9efdfcca0f83`
- Security rules (`/firestore.rules`) are deployed and enforced:
  - Public visitors can submit booking requests to `bookings` (`status == 'PENDING'`, no login required) and read public `settings/public`, active `announcements`, `room_categories`, and `floors`.
  - Public visitors cannot read `bookings`, `rooms`, `admins`, `room_allocations`, or `audit_logs`.
  - Super Admin (`nadtrc.bengaluru@gmail.com`) and active Admin accounts manage rooms, allocations, bookings, reports, CMS, and audit logs.

## 2. Enabling Super Admin Email/Password Sign-In
By default, Firebase provisioning enables Google Sign-In. To also sign in with User ID (`nadtrc.bengaluru@gmail.com`) and your password (`nadt@2022` or a password of your choice):
1. Open [Firebase Authentication Sign-in Providers](https://console.firebase.google.com/project/semiotic-pact-423605-b6/authentication/providers).
2. Click **Email/Password**, toggle **Enable** ON, and click **Save**.
3. Open `/admin` in the portal and click **Sign In with Google (Super Admin)** using `nadtrc.bengaluru@gmail.com`.
   - This verifies `nadtrc.bengaluru@gmail.com`, initializes the `SUPER_ADMIN` document in Firestore, and automatically seeds all 84 rooms (including Room `411` Double Non-AC, Room `416` Pending Verification, and the 17 CR Building rooms), 6 floors, 7 categories, and CMS defaults.
4. Go to **Account Security** in the Super Admin dashboard and set your password (e.g., `nadt@2022`).
   - Your verified account now works seamlessly with **both** User ID/Password and Google Sign-In.

## 3. Vercel Deployment
- Build Command: `npm run build`
- Output Directory: `dist`
- `/vercel.json` rewrites all routes (`/admin`, `/`) to `/index.html`.
- Ensure your production Vercel domain is added under **Firebase Console → Authentication → Settings → Authorized domains**.

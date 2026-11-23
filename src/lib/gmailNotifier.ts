import {deleteApp, initializeApp} from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type UserCredential,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {auth, GMAIL_SEND_SCOPE, gmailProvider} from '../firebase.ts';
import type {Booking, SiteSettingsDoc} from '../types/database.ts';

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGmailSenderEmail: string | null = null;
let cachedGmailExpiresAt = 0;

type TokenListener = () => void;
const listeners = new Set<TokenListener>();

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeGmailConnection(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearGmailAccessToken(): void {
  if (!cachedGmailAccessToken && !cachedGmailSenderEmail) return;
  cachedGmailAccessToken = null;
  cachedGmailSenderEmail = null;
  cachedGmailExpiresAt = 0;
  notifyListeners();
}

export function getGmailConnectionState(): {
  connected: boolean;
  senderEmail: string | null;
} {
  if (cachedGmailAccessToken && Date.now() >= cachedGmailExpiresAt) {
    cachedGmailAccessToken = null;
    cachedGmailSenderEmail = null;
    cachedGmailExpiresAt = 0;
  }
  return {
    connected: Boolean(cachedGmailAccessToken),
    senderEmail: cachedGmailSenderEmail,
  };
}

export function captureGmailTokenFromCredential(
  result: UserCredential,
): boolean {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    return false;
  }
  cachedGmailAccessToken = credential.accessToken;
  cachedGmailSenderEmail = result.user.email || cachedGmailSenderEmail;
  // Google OAuth access tokens typically live ~55 minutes
  cachedGmailExpiresAt = Date.now() + 50 * 60 * 1000;
  notifyListeners();
  return true;
}

export async function connectGmailAccountForSending(
  preferredEmail?: string,
): Promise<{senderEmail: string | null}> {
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SEND_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
    ...(preferredEmail ? {login_hint: preferredEmail} : {}),
  });

  const currentUser = auth.currentUser;
  const hasGoogleProvider = Boolean(
    currentUser?.providerData.some((p) => p.providerId === 'google.com'),
  );

  if (currentUser && hasGoogleProvider) {
    const result = await reauthenticateWithPopup(currentUser, gmailProvider);
    const ok = captureGmailTokenFromCredential(result);
    if (!ok) {
      throw new Error(
        'Gmail send permission was not returned by Google. Please allow Gmail access and try again.',
      );
    }
    return {senderEmail: cachedGmailSenderEmail};
  }

  // If signed in via User ID / Password (or no Google link on current user),
  // authorize Gmail via a temporary secondary Firebase app instance so the
  // active admin session is preserved untouched.
  const tempApp = initializeApp(firebaseConfig, `GmailOAuth-${Date.now()}`);
  const tempAuth = getAuth(tempApp);
  try {
    const result = await signInWithPopup(tempAuth, provider);
    const ok = captureGmailTokenFromCredential(result);
    if (!ok) {
      throw new Error(
        'Gmail send permission was not returned by Google. Please allow Gmail access and try again.',
      );
    }
    await signOut(tempAuth).catch(() => {});
    return {senderEmail: cachedGmailSenderEmail};
  } finally {
    await deleteApp(tempApp).catch(() => {});
  }
}

export interface BookingEmailDraft {
  to: string;
  subject: string;
  bodyText: string;
  decision: 'APPROVED' | 'REJECTED';
  allottedRooms: string[];
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function buildBookingDecisionEmailDraft(params: {
  booking: Booking;
  decision: 'APPROVED' | 'REJECTED';
  assignedRoomNumbers: string[];
  checkInDate: string;
  checkOutDate: string;
  adminRemarks: string;
  settings?: SiteSettingsDoc;
}): BookingEmailDraft {
  const {
    booking,
    decision,
    assignedRoomNumbers,
    checkInDate,
    checkOutDate,
    adminRemarks,
    settings,
  } = params;

  const campusName = settings?.site_title || 'NADT Regional Campus, Bengaluru';
  const checkInTime = settings?.check_in_time || '12:00 Noon';
  const checkOutTime = settings?.check_out_time || '11:00 AM';
  const contactEmail = settings?.contact_email || 'nadtrc.bengaluru@gmail.com';
  const contactPhone = settings?.contact_phone || '';
  const campusAddress = settings?.campus_address || '';

  const roomList =
    assignedRoomNumbers.length > 0
      ? assignedRoomNumbers.join(', ')
      : 'To be allotted at reception';

  const cleanRemarks = adminRemarks.trim();

  if (decision === 'APPROVED') {
    const subject = sanitizeHeaderValue(
      `Hostel Booking Approved – Ref ${booking.booking_ref} | Room ${roomList} | ${campusName}`,
    );

    const lines = [
      `Dear ${booking.applicant_name},`,
      '',
      `Your hostel accommodation request at ${campusName} has been APPROVED.`,
      '',
      'BOOKING & ROOM ALLOTMENT DETAILS',
      '----------------------------------------',
      `Booking Reference Number : ${booking.booking_ref}`,
      `Status                   : APPROVED`,
      `Allotted Room Number(s)  : ${roomList}`,
      `Room Category            : ${booking.preferred_category}`,
      `Check-In Date            : ${checkInDate} (Check-in time: ${checkInTime})`,
      `Check-Out Date           : ${checkOutDate} (Check-out time: ${checkOutTime})`,
      `No. of Persons           : ${booking.num_persons}`,
      ...(cleanRemarks ? [`Administrator Remarks    : ${cleanRemarks}`] : []),
      '',
      'CHECK-IN INSTRUCTIONS',
      '----------------------------------------',
      `Please present a valid official Photo ID along with your Booking Reference Number (${booking.booking_ref}) at the hostel reception upon arrival.`,
      ...(campusAddress ? [`Campus Address: ${campusAddress}`] : []),
      `For any assistance, please contact: ${contactEmail}${contactPhone ? ` | ${contactPhone}` : ''}`,
      '',
      'Regards,',
      `Campus Administrator`,
      campusName,
    ];

    return {
      to: sanitizeHeaderValue(booking.email),
      subject,
      bodyText: lines.join('\n'),
      decision: 'APPROVED',
      allottedRooms: assignedRoomNumbers,
    };
  }

  const subject = sanitizeHeaderValue(
    `Hostel Booking Request Update (Not Approved) – Ref ${booking.booking_ref} | ${campusName}`,
  );

  const lines = [
    `Dear ${booking.applicant_name},`,
    '',
    `Thank you for submitting your hostel booking request to ${campusName}.`,
    `We regret to inform you that your booking request has NOT been approved / has been REJECTED.`,
    '',
    'REQUEST SUMMARY',
    '----------------------------------------',
    `Booking Reference Number : ${booking.booking_ref}`,
    `Status                   : REJECTED`,
    `Requested Dates          : ${checkInDate} to ${checkOutDate}`,
    `Preferred Room Category  : ${booking.preferred_category}`,
    `Reason / Remarks         : ${cleanRemarks || 'Rooms are unavailable for the requested dates or criteria.'}`,
    '',
    `You may check your booking status online anytime using your Booking Reference Number: ${booking.booking_ref}.`,
    `For further clarification, please contact: ${contactEmail}${contactPhone ? ` | ${contactPhone}` : ''}`,
    '',
    'Regards,',
    `Campus Administrator`,
    campusName,
  ];

  return {
    to: sanitizeHeaderValue(booking.email),
    subject,
    bodyText: lines.join('\n'),
    decision: 'REJECTED',
    allottedRooms: [],
  };
}

function encodeBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sendBookingDecisionEmail(
  draft: BookingEmailDraft,
): Promise<{messageId: string; senderEmail: string | null}> {
  if (!isValidEmailAddress(draft.to)) {
    throw new Error(`Invalid applicant email address: "${draft.to}".`);
  }

  const {connected, senderEmail} = getGmailConnectionState();
  if (!connected || !cachedGmailAccessToken) {
    throw new Error(
      'Gmail is not connected in this session. Click "Connect Gmail" to grant send permission and retry.',
    );
  }

  const safeTo = sanitizeHeaderValue(draft.to);
  const safeSubject = sanitizeHeaderValue(draft.subject);
  const encodedSubject = `=?UTF-8?B?${btoa(
    String.fromCharCode(...new TextEncoder().encode(safeSubject)),
  )}?=`;

  const mimeMessage = [
    `To: ${safeTo}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    draft.bodyText,
  ].join('\r\n');

  const raw = encodeBase64UrlUtf8(mimeMessage);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cachedGmailAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({raw}),
    },
  );

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = (await response.json()) as {
        error?: {message?: string; status?: string};
      };
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch {
      // ignore non-JSON error body
    }

    if (
      response.status === 403 &&
      (errorDetail.includes('has not been used in project') ||
        errorDetail.includes('is disabled'))
    ) {
      throw new Error(
        `Gmail API is not enabled on this Firebase project yet (${errorDetail}). Enable "Gmail API" in Google Cloud Console for this project and retry.`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      clearGmailAccessToken();
      throw new Error(
        `Gmail authorization expired or missing send permission (${errorDetail}). Please reconnect Gmail and retry sending.`,
      );
    }

    throw new Error(`Gmail API failed to send notification: ${errorDetail}`);
  }

  const data = (await response.json()) as {id?: string};
  return {
    messageId: data.id || 'SENT',
    senderEmail,
  };
}

export function buildMailtoFallbackUrl(draft: BookingEmailDraft): string {
  const to = encodeURIComponent(draft.to);
  const subject = encodeURIComponent(draft.subject);
  const body = encodeURIComponent(draft.bodyText);
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

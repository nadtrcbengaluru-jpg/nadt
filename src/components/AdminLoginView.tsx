import {useState, type FormEvent} from 'react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Shield,
} from 'lucide-react';
import {
  auth,
  FIREBASE_PROJECT_ID,
  googleProvider,
  SUPER_ADMIN_EMAIL,
} from '../firebase.ts';
import type {AdminUser} from '../types/database.ts';
import {ensureAdminProfile} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface AdminLoginViewProps {
  initialNotice?: string | null;
  onLoginSuccess: (admin: AdminUser) => void;
  onBackToPublic: () => void;
}

export function AdminLoginView({
  initialNotice,
  onLoginSuccess,
  onBackToPublic,
}: AdminLoginViewProps) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialNotice || null);
  const [showPasswordProviderHelp, setShowPasswordProviderHelp] =
    useState(false);

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setShowPasswordProviderHelp(false);

    if (!userId.trim() || !password) {
      setError('Enter both your Administrator User ID (Email) and Password.');
      return;
    }

    setSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        userId.trim(),
        password,
      );
      const adminProfile = await ensureAdminProfile(cred.user);
      onLoginSuccess(adminProfile);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as {code: unknown}).code)
          : '';
      const msg = extractReadableError(err);

      if (
        code === 'auth/operation-not-allowed' ||
        msg.includes('PASSWORD_LOGIN_DISABLED') ||
        msg.includes('operation-not-allowed')
      ) {
        setShowPasswordProviderHelp(true);
        setError(
          'Email/Password sign-in is not yet enabled in Firebase Authentication for this project. Enable it in Firebase Console or sign in immediately with Google below.',
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError(
          'Invalid User ID or Password. If this is the first Super Admin login, sign in once with Google below to initialize the account and set/link your password in Account Security.',
        );
      } else {
        setError(msg);
      }
      await signOut(auth).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setShowPasswordProviderHelp(false);
    setGoogleSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const adminProfile = await ensureAdminProfile(cred.user);
      onLoginSuccess(adminProfile);
    } catch (err: unknown) {
      setError(extractReadableError(err));
      await signOut(auth).catch(() => {});
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between px-4 py-8">
      <div className="max-w-md w-full mx-auto">
        <button
          type="button"
          onClick={onBackToPublic}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Public Booking Portal
        </button>
      </div>

      <div className="max-w-md w-full mx-auto my-8 bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 pb-6 border-b border-slate-200">
          <div className="w-10 h-10 rounded-lg bg-[#0F2942] text-white flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Administrator Sign In
            </h1>
            <p className="text-xs text-slate-500">
              NADT Regional Campus, Bengaluru · Authorized Access Only
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {showPasswordProviderHelp && (
          <div className="mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2">
            <div className="font-semibold">
              How to Enable User ID / Password Sign-In in Firebase Console:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-amber-900">
              <li>Open Firebase Authentication Providers for project {FIREBASE_PROJECT_ID}.</li>
              <li>Select Email/Password → Enable → Save.</li>
              <li>
                Sign in below using Google ({SUPER_ADMIN_EMAIL}) first, then attach your desired password under Account Security.
              </li>
            </ol>
            <a
              href={firebaseProvidersUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#0F2942] underline"
            >
              Open Firebase Auth Providers
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <div className="mt-6 space-y-4">
          <button
            type="button"
            disabled={googleSubmitting || submitting}
            onClick={() => void handleGoogleSignIn()}
            className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 border border-slate-300 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            {googleSubmitting
              ? 'Signing In with Google...'
              : 'Sign In with Google (Super Admin)'}
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink-0 mx-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Or User ID &amp; Password
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>
        </div>

        <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-5">
          <div>
            <label
              htmlFor="admin-userid"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              User ID (Email)
            </label>
            <input
              id="admin-userid"
              type="email"
              autoComplete="username"
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter administrator User ID"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="w-full py-2.5 px-4 bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            {submitting ? 'Verifying Credentials...' : 'Sign In with User ID'}
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500 leading-relaxed border-t border-slate-200 pt-4">
          Public room booking applicants do not require an account. Administrative sessions are
          protected by Firebase Authentication and Firestore Security Rules.
        </p>
      </div>

      <div className="max-w-md w-full mx-auto text-center text-xs text-slate-400">
        NADT Regional Campus, Bengaluru
      </div>
    </div>
  );
}

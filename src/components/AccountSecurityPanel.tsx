import {useState, type FormEvent} from 'react';
import {AlertCircle, CheckCircle2, ExternalLink, KeyRound} from 'lucide-react';
import {auth, FIREBASE_PROJECT_ID} from '../firebase.ts';
import type {AdminUser} from '../types/database.ts';
import {changeOrLinkOwnPassword} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface AccountSecurityPanelProps {
  admin: AdminUser;
}

export function AccountSecurityPanel({admin}: AccountSecurityPanelProps) {
  const [hasPasswordLinked, setHasPasswordLinked] = useState<boolean>(() =>
    Boolean(auth.currentUser?.providerData.some((p) => p.providerId === 'password')),
  );
  const hasGoogleLinked = Boolean(
    auth.currentUser?.providerData.some((p) => p.providerId === 'google.com'),
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProviderEnable, setNeedsProviderEnable] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setNeedsProviderEnable(false);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await changeOrLinkOwnPassword({
        currentPassword: hasPasswordLinked ? currentPassword : undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (outcome === 'LINKED') {
        setHasPasswordLinked(true);
      }
      setSuccess(
        outcome === 'LINKED'
          ? `Password credential created and linked to ${admin.email}. You can now sign in with User ID/Password or Google.`
          : 'Your password has been updated securely in Firebase Authentication.',
      );
    } catch (err) {
      const msg = extractReadableError(err);
      if (msg.includes('operation-not-allowed') || msg.includes('PASSWORD_LOGIN_DISABLED')) {
        setNeedsProviderEnable(true);
        setError(
          'Email/Password sign-in is not yet enabled in Firebase Authentication for this project. Enable it in Firebase Console first, then click Set & Link Password again.',
        );
      } else if (msg.includes('requires-recent-login')) {
        setError(
          'Please sign out and sign back in once, then set/update your password immediately.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Account Security</h2>
        <p className="text-sm text-slate-600 mt-1">
          Signed in as <span className="font-mono text-slate-900">{admin.email}</span> ·{' '}
          {admin.role === 'SUPER_ADMIN' ? 'Super Administrator' : 'Administrator'}
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200">
          <KeyRound className="w-4 h-4 text-[#0F2942]" />
          <h3 className="text-base font-semibold text-slate-900">
            {hasPasswordLinked
              ? 'Change Account Password'
              : 'Set User ID & Password Sign-In'}
          </h3>
        </div>

        <div className="mt-4 text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            User ID: <strong className="font-mono text-slate-900">{admin.email}</strong>
          </span>
          <span>·</span>
          <span>
            Google Sign-In:{' '}
            <strong className={hasGoogleLinked ? 'text-emerald-700' : 'text-slate-500'}>
              {hasGoogleLinked ? 'Active' : 'Not Linked'}
            </strong>
          </span>
          <span>·</span>
          <span>
            Password Login:{' '}
            <strong className={hasPasswordLinked ? 'text-emerald-700' : 'text-amber-700'}>
              {hasPasswordLinked ? 'Active' : 'Not Set Yet'}
            </strong>
          </span>
        </div>

        {!hasPasswordLinked && (
          <p className="mt-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            Your account is currently signed in with Google. Enter a password below (minimum 8
            characters) to create User ID &amp; Password credentials for{' '}
            <span className="font-mono">{admin.email}</span>.
          </p>
        )}

        {error && (
          <div className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
            {needsProviderEnable && (
              <div className="pl-6">
                <a
                  href={firebaseProvidersUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F2942] underline"
                >
                  Open Firebase Authentication Sign-In Providers ({FIREBASE_PROJECT_ID})
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        )}

        {success && (
          <div className="mt-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {hasPasswordLinked && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Current Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {submitting
                ? 'Saving Password...'
                : hasPasswordLinked
                  ? 'Update Password'
                  : 'Set & Link Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

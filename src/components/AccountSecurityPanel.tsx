import {useState, type FormEvent} from 'react';
import {AlertCircle, CheckCircle2, KeyRound} from 'lucide-react';
import {auth} from '../firebase.ts';
import type {AdminUser} from '../types/database.ts';
import {changeOrLinkOwnPassword} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface AccountSecurityPanelProps {
  admin: AdminUser;
}

export function AccountSecurityPanel({admin}: AccountSecurityPanelProps) {
  const hasPasswordLinked = Boolean(
    auth.currentUser?.providerData.some((p) => p.providerId === 'password'),
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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
      setSuccess(
        outcome === 'LINKED'
          ? 'Password linked to your Firebase account. You can now sign in with both User ID/Password and Google.'
          : 'Your password has been updated securely in Firebase Authentication.',
      );
    } catch (err) {
      const msg = extractReadableError(err);
      if (msg.includes('operation-not-allowed')) {
        setError(
          'Enable the Email/Password provider in Firebase Console Authentication → Sign-in method before linking a password.',
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

        {!hasPasswordLinked && (
          <p className="mt-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            Your account is currently signed in with Google. Setting a password here links Email/Password credentials directly to{' '}
            <span className="font-mono">{admin.email}</span> so you can also sign in using User ID and Password.
          </p>
        )}

        {error && (
          <div className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
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

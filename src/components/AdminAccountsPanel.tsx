import {useEffect, useState, type FormEvent} from 'react';
import {AlertCircle, CheckCircle2, Mail, RefreshCw, UserPlus} from 'lucide-react';
import type {AdminUser} from '../types/database.ts';
import {
  createStandardAdminAccount,
  fetchAdminsInFirestore,
  sendAdminPasswordResetEmail,
  toggleAdminActiveStatusInFirestore,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface AdminAccountsPanelProps {
  currentAdmin: AdminUser;
}

export function AdminAccountsPanel({currentAdmin}: AdminAccountsPanelProps) {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingCreate, setSavingCreate] = useState(false);

  const loadAdmins = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminsInFirestore();
      setAdmins(list);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAdmins();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSavingCreate(true);
    try {
      const created = await createStandardAdminAccount(
        {
          email: newEmail.trim(),
          full_name: newFullName.trim(),
          password: newPassword,
        },
        currentAdmin,
      );
      setAdmins((prev) => [...prev, created]);
      setNewEmail('');
      setNewFullName('');
      setNewPassword('');
      setShowCreateForm(false);
      setNotice(`Admin account provisioned in Firebase for ${created.email}.`);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingCreate(false);
    }
  };

  const handleToggleActive = async (target: AdminUser) => {
    setError(null);
    setNotice(null);
    try {
      const updated = await toggleAdminActiveStatusInFirestore(
        target,
        currentAdmin,
      );
      setAdmins((prev) =>
        prev.map((a) => (a.admin_id === updated.admin_id ? updated : a)),
      );
      setNotice(
        `${updated.email} has been ${updated.is_active ? 'activated' : 'deactivated'}.`,
      );
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  const handleSendPasswordReset = async (target: AdminUser) => {
    setError(null);
    setNotice(null);
    try {
      await sendAdminPasswordResetEmail(target, currentAdmin);
      setNotice(`Firebase password reset email sent to ${target.email}.`);
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Administrator Accounts
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Create, activate, deactivate, and manage Admin accounts in Firebase Authentication &amp; Firestore.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void loadAdmins()}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {showCreateForm ? 'Close Form' : 'Create Admin'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-slate-900">
            Create New Admin Account
          </h3>
          <p className="text-xs text-slate-500">
            New accounts are provisioned with standard ADMIN role and direct User ID / Password login in Firebase Auth.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Hostel Warden"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                User ID (Email)
              </label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="admin@nadtrc.example"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Initial Password (min 8 chars)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter initial password"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingCreate}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#173a5c] disabled:opacity-60 cursor-pointer"
            >
              {savingCreate ? 'Creating...' : 'Save Admin Account'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="py-3 px-4">Administrator</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Last Login</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-slate-500">
                  Loading administrator records from Firestore...
                </td>
              </tr>
            ) : admins.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-slate-500">
                  No administrator records found.
                </td>
              </tr>
            ) : (
              admins.map((adm) => {
                const isSelfSuper =
                  adm.role === 'SUPER_ADMIN' ||
                  adm.admin_id === currentAdmin.admin_id;
                return (
                  <tr key={adm.admin_id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">
                        {adm.full_name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {adm.email}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                      {adm.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span
                        className={
                          adm.is_active
                            ? 'text-emerald-700 font-medium'
                            : 'text-slate-500 font-medium'
                        }
                      >
                        {adm.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 font-mono tabular-nums">
                      {adm.last_login_at
                        ? new Date(adm.last_login_at).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSendPasswordReset(adm)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Mail className="w-3 h-3" />
                          Send Reset Email
                        </button>
                        {!isSelfSuper && (
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(adm)}
                            className={`px-2.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                              adm.is_active
                                ? 'text-red-700 bg-red-50 border-red-200 hover:bg-red-100'
                                : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            {adm.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

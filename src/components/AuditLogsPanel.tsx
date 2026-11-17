import {useEffect, useMemo, useState} from 'react';
import {AlertCircle, RefreshCw, Search} from 'lucide-react';
import type {AuditLog} from '../types/database.ts';
import {fetchAuditLogsInFirestore} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

export function AuditLogsPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAuditLogsInFirestore(200);
      setLogs(list);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        String(l.action).toLowerCase().includes(q) ||
        String(l.actor_email).toLowerCase().includes(q) ||
        String(l.entity_type).toLowerCase().includes(q) ||
        String(l.entity_id).toLowerCase().includes(q) ||
        String(l.details_summary).toLowerCase().includes(q),
    );
  }, [logs, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Security &amp; Activity Audit Logs
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Immutable trail of administrator provisioning, room updates, bookings, and CMS changes in Firestore.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLogs()}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Logs
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by action, user email, entity..."
          className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F2942]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Actor</th>
              <th className="py-3 px-4">Target</th>
              <th className="py-3 px-4">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-sm text-slate-500">
                  Loading audit logs...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-sm text-slate-500">
                  No matching audit entries found.
                </td>
              </tr>
            ) : (
              filtered.map((log) => (
                <tr key={log.log_id} className="hover:bg-slate-50 align-top">
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                    {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {log.action}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    <div>{log.actor_email || log.actor_id}</div>
                    <div className="text-slate-400">{log.actor_role}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                    {log.entity_type} · <span className="font-mono">{log.entity_id}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-sm">
                    {log.details_summary}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

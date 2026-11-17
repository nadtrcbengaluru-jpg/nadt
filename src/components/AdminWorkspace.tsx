import {useCallback, useEffect, useState} from 'react';
import {
  AlertCircle,
  BedDouble,
  CalendarClock,
  FileBarChart,
  Globe,
  KeyRound,
  LogOut,
  Menu,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import type {AdminUser} from '../types/database.ts';
import {fetchAdminSnapshot, type AdminSnapshotData} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import {AccountSecurityPanel} from './AccountSecurityPanel.tsx';
import {AdminAccountsPanel} from './AdminAccountsPanel.tsx';
import {AuditLogsPanel} from './AuditLogsPanel.tsx';
import {BookingsPanel} from './BookingsPanel.tsx';
import {DashboardReportsPanel} from './DashboardReportsPanel.tsx';
import {RoomInventoryPanel} from './RoomInventoryPanel.tsx';
import {WebsiteCmsPanel} from './WebsiteCmsPanel.tsx';

type WorkspaceSection =
  | 'reports'
  | 'rooms'
  | 'bookings'
  | 'admins'
  | 'cms'
  | 'audit'
  | 'security';

interface AdminWorkspaceProps {
  admin: AdminUser;
  onLogout: () => Promise<void>;
  onOpenPublicPortal: () => void;
}

export function AdminWorkspace({
  admin,
  onLogout,
  onOpenPublicPortal,
}: AdminWorkspaceProps) {
  const isSuperAdmin = admin.role === 'SUPER_ADMIN';
  const [activeTab, setActiveTab] = useState<WorkspaceSection>('reports');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [snapshot, setSnapshot] = useState<AdminSnapshotData | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    setSnapshotError(null);
    try {
      const data = await fetchAdminSnapshot(isSuperAdmin);
      setSnapshot(data);
    } catch (err) {
      setSnapshotError(extractReadableError(err));
    } finally {
      setLoadingSnapshot(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: typeof Users;
    badge?: number;
  }> = [
    {id: 'reports', label: 'Dashboard & Reports', icon: FileBarChart},
    {
      id: 'bookings',
      label: 'Booking Requests',
      icon: CalendarClock,
      badge: snapshot
        ? snapshot.bookings.filter((b) => b.status === 'PENDING').length
        : undefined,
    },
    {id: 'rooms', label: 'Room Inventory', icon: BedDouble},
    ...(isSuperAdmin
      ? [
          {id: 'admins' as const, label: 'Admin Accounts', icon: Users},
          {id: 'cms' as const, label: 'Website CMS', icon: Globe},
          {id: 'audit' as const, label: 'Audit Logs', icon: ShieldAlert},
        ]
      : []),
    {id: 'security', label: 'Account Security', icon: KeyRound},
  ];

  const activeMeta = navItems.find((item) => item.id === activeTab) || navItems[0];

  const handleLogoutClick = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-white border-r border-slate-200 shrink-0">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center">
          <div>
            <div className="text-sm font-bold text-slate-900">NADT Bengaluru</div>
            <div className="text-xs text-slate-500">
              {isSuperAdmin ? 'Super Admin Console' : 'Admin Console'}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  active ? 'bg-[#0F2942] text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      active ? 'text-amber-200' : 'text-amber-700 font-semibold'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-slate-900 truncate">{admin.full_name}</div>
            <div className="text-slate-500 font-mono truncate">{admin.email}</div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenPublicPortal}
              className="w-full px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer text-left"
            >
              View Public Portal
            </button>
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => void handleLogoutClick()}
              className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 inline-flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              {loggingOut ? 'Signing Out...' : 'Sign Out'}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-full bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">NADT Bengaluru</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-[#0F2942] text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2">
              <button
                type="button"
                onClick={onOpenPublicPortal}
                className="w-full px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg text-left"
              >
                View Public Portal
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogoutClick()}
                className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg inline-flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                {loggingOut ? 'Signing Out...' : 'Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm text-slate-500 truncate">
              <span>{isSuperAdmin ? 'Super Admin' : 'Admin'}</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900">{activeMeta.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-600 font-mono">
              {admin.email}
            </span>
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => void handleLogoutClick()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer whitespace-nowrap"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {snapshotError && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{snapshotError}</span>
            </div>
          )}

          {loadingSnapshot && !snapshot && activeTab !== 'security' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              Syncing live inventory and booking records from Firebase Firestore...
            </div>
          ) : (
            <>
              {activeTab === 'reports' && snapshot && (
                <DashboardReportsPanel
                  rooms={snapshot.rooms}
                  floors={snapshot.floors}
                  categories={snapshot.categories}
                  bookings={snapshot.bookings}
                  onRefresh={refreshSnapshot}
                />
              )}

              {activeTab === 'rooms' && snapshot && (
                <RoomInventoryPanel
                  admin={admin}
                  rooms={snapshot.rooms}
                  floors={snapshot.floors}
                  categories={snapshot.categories}
                  onRefresh={refreshSnapshot}
                />
              )}

              {activeTab === 'bookings' && snapshot && (
                <BookingsPanel
                  admin={admin}
                  bookings={snapshot.bookings}
                  categories={snapshot.categories}
                  onRefresh={refreshSnapshot}
                />
              )}

              {activeTab === 'admins' && isSuperAdmin && (
                <AdminAccountsPanel currentAdmin={admin} />
              )}

              {activeTab === 'cms' && isSuperAdmin && snapshot && (
                <WebsiteCmsPanel
                  admin={admin}
                  settings={snapshot.settings}
                  announcements={snapshot.announcements}
                  categories={snapshot.categories}
                  floors={snapshot.floors}
                  onRefresh={refreshSnapshot}
                />
              )}

              {activeTab === 'audit' && isSuperAdmin && <AuditLogsPanel />}

              {activeTab === 'security' && <AccountSecurityPanel admin={admin} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

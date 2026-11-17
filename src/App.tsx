import {useEffect, useState} from 'react';
import {onAuthStateChanged, signOut} from 'firebase/auth';
import {auth} from './firebase.ts';
import type {AdminUser} from './types/database.ts';
import {ensureAdminProfile} from './lib/firestoreDb.ts';
import {extractReadableError} from './lib/firestoreError.ts';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {PublicPortalShell} from './components/PublicPortalShell.tsx';
import {AdminLoginView} from './components/AdminLoginView.tsx';
import {AdminWorkspace} from './components/AdminWorkspace.tsx';

type AppView = 'public' | 'login' | 'workspace';

export default function App() {
  const [view, setView] = useState<AppView>(() =>
    window.location.pathname.startsWith('/admin') ? 'login' : 'public',
  );
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    const initialPath = window.location.pathname;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setAdmin(null);
        if (initialPath.startsWith('/admin')) {
          setView((prev) => (prev === 'workspace' ? 'login' : prev));
        }
        setInitializing(false);
        return;
      }

      try {
        const profile = await ensureAdminProfile(user);
        if (!active) return;
        setAdmin(profile);
        setAuthNotice(null);
        if (window.location.pathname.startsWith('/admin')) {
          setView('workspace');
        }
      } catch (err) {
        if (!active) return;
        setAdmin(null);
        setAuthNotice(extractReadableError(err));
        await signOut(auth).catch(() => {});
        if (window.location.pathname.startsWith('/admin')) {
          setView('login');
        }
      } finally {
        if (active) setInitializing(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const openAdminArea = () => {
    window.history.pushState(null, '', '/admin');
    setView(admin ? 'workspace' : 'login');
  };

  const openPublicPortal = () => {
    window.history.pushState(null, '', '/');
    setView('public');
  };

  const handleLoginSuccess = (loggedInAdmin: AdminUser) => {
    setAdmin(loggedInAdmin);
    setAuthNotice(null);
    window.history.pushState(null, '', '/admin');
    setView('workspace');
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAdmin(null);
    window.history.pushState(null, '', '/admin');
    setView('login');
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Loading NADT Regional Campus, Bengaluru Portal...
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {view === 'workspace' && admin ? (
        <AdminWorkspace
          admin={admin}
          onLogout={handleLogout}
          onOpenPublicPortal={openPublicPortal}
        />
      ) : view === 'login' ? (
        <AdminLoginView
          initialNotice={authNotice}
          onLoginSuccess={handleLoginSuccess}
          onBackToPublic={openPublicPortal}
        />
      ) : (
        <PublicPortalShell onOpenAdminLogin={openAdminArea} />
      )}
    </ErrorBoundary>
  );
}

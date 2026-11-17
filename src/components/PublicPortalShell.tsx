import {useEffect, useState} from 'react';
import {Building2, CalendarCheck, Megaphone, ShieldCheck} from 'lucide-react';
import {
  fetchPublicBootstrap,
  type PublicBootstrapData,
} from '../lib/firestoreDb.ts';
import {DEFAULT_SITE_SETTINGS, INITIAL_CATEGORIES} from '../lib/seedFirestore.ts';
import {PublicBookingForm} from './PublicBookingForm.tsx';

interface PublicPortalShellProps {
  onOpenAdminLogin: () => void;
}

export function PublicPortalShell({onOpenAdminLogin}: PublicPortalShellProps) {
  const [bootstrap, setBootstrap] = useState<PublicBootstrapData | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicBootstrap().then((res) => {
      if (active) setBootstrap(res);
    });
    return () => {
      active = false;
    };
  }, []);

  const settings = bootstrap?.settings || {
    ...DEFAULT_SITE_SETTINGS,
    updated_at: '',
  };

  const categories =
    bootstrap?.categories ||
    INITIAL_CATEGORIES.filter((c) => c.is_bookable).map((c) => ({
      ...c,
      created_at: '',
      updated_at: '',
    }));

  const announcements = bootstrap?.announcements || [];

  const scrollToBooking = () => {
    document
      .getElementById('booking-facility')
      ?.scrollIntoView({behavior: 'smooth'});
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="flex items-center gap-3 text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {settings.logo_url && (
              <img
                src={settings.logo_url}
                alt={settings.site_title}
                referrerPolicy="no-referrer"
                className="h-8 w-8 object-contain rounded shrink-0"
              />
            )}
            <span>{settings.site_title}</span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#categories"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Categories
            </a>
            <a
              href="#guidelines"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Guidelines
            </a>
            <a
              href="#contact"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Admin Login
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={scrollToBooking}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#173a5c] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Request Room
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {announcements.length > 0 && (
          <div className="bg-amber-50 border-b border-amber-200">
            <div className="max-w-7xl mx-auto px-6 py-3 space-y-1.5">
              {announcements.map((ann) => (
                <div
                  key={ann.announcement_id}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <Megaphone className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-amber-950">
                      {ann.title}:{' '}
                    </span>
                    <span className="text-amber-900">{ann.content}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <section className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-14 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-5">
              <p className="text-xs font-semibold tracking-wider uppercase text-amber-800">
                {settings.site_subtitle}
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-[40px] font-bold tracking-tight text-slate-900 leading-tight text-balance">
                {settings.hero_heading}
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                {settings.hero_description}
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={scrollToBooking}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2942] rounded-lg hover:bg-[#173a5c] transition-colors cursor-pointer"
                >
                  Submit Booking Request
                </button>
                <button
                  type="button"
                  onClick={onOpenAdminLogin}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Administration Sign In
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-start gap-3">
                <CalendarCheck className="w-5 h-5 text-[#0F2942] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Open Applicant Request Flow
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Applicants submit requests directly without passwords or verification emails.
                    Every request receives a unique reference number and enters review as PENDING.
                  </p>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 flex items-start gap-3">
                <Building2 className="w-5 h-5 text-[#0F2942] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Campus Guest House Inventory
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Six floors spanning Single, Double, Queen Size, and VIP suites, with dedicated
                    CR Building allocations managed by Campus Administration.
                  </p>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#0F2942] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Date-Wise Availability Verification
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Specific room numbers are allotted only after Administrator review and
                    conflict-free availability checks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="booking-facility"
          className="max-w-7xl mx-auto px-6 py-12"
        >
          <PublicBookingForm
            categories={categories}
            showDesignation={settings.show_designation}
            showPurpose={settings.show_purpose}
            showSpecialRequirements={settings.show_special_requirements}
            showApplicantRemarks={settings.show_applicant_remarks}
          />
        </section>

        <section id="categories" className="max-w-7xl mx-auto px-6 pb-12">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">
              Accommodation Categories
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Available room categories managed dynamically by Campus Administration.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3.5 px-5">Category</th>
                  <th className="py-3.5 px-5">Bed &amp; Climate</th>
                  <th className="py-3.5 px-5">Description</th>
                  <th className="py-3.5 px-5 text-right">
                    Standard Capacity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {categories.map((item) => (
                  <tr key={item.category_id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-5 font-medium text-slate-900">
                      {item.category_name}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600">
                      {item.bed_type} · {item.ac_type}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600">
                      {item.description}
                    </td>
                    <td className="py-3.5 px-5 text-right text-slate-700 tabular-nums">
                      {item.default_capacity} Guest(s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="guidelines" className="max-w-7xl mx-auto px-6 pb-14">
          <div className="bg-white border border-slate-200 rounded-xl p-8">
            <h2 className="text-xl font-bold text-slate-900">
              Booking Guidelines &amp; Campus Contact
            </h2>
            <p className="text-sm text-slate-600 mt-2 max-w-4xl leading-relaxed">
              {settings.booking_guidelines}
            </p>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-200 pt-6 text-sm">
              <div>
                <div className="font-semibold text-slate-900">
                  Check-in &amp; Check-out
                </div>
                <p className="text-slate-600 mt-1">
                  Standard check-in at {settings.check_in_time} and check-out at{' '}
                  {settings.check_out_time}.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900">
                  Campus Address
                </div>
                <p className="text-slate-600 mt-1">
                  {settings.campus_address}
                </p>
              </div>
              <div id="contact">
                <div className="font-semibold text-slate-900">
                  Administration Desk
                </div>
                <p className="text-slate-600 mt-1">
                  <span className="font-mono text-xs">
                    {settings.contact_email}
                  </span>
                  <br />
                  <span className="font-mono text-xs">
                    {settings.contact_phone}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>{settings.footer_text}</span>
          <button
            type="button"
            onClick={onOpenAdminLogin}
            className="text-slate-700 font-medium hover:text-slate-900 underline underline-offset-4 cursor-pointer"
          >
            Staff &amp; Super Admin Portal
          </button>
        </div>
      </footer>
    </div>
  );
}

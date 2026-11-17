import {useEffect, useState, type ChangeEvent, type FormEvent} from 'react';
import {AlertCircle, CheckCircle2, Plus, Trash2} from 'lucide-react';
import type {
  AcType,
  AdminUser,
  Announcement,
  BedType,
  Floor,
  RoomCategory,
  SiteSettingsDoc,
} from '../types/database.ts';
import {
  deleteAnnouncementInFirestore,
  savePublicSiteSettings,
  updateFloorInFirestore,
  upsertAnnouncementInFirestore,
  upsertCategoryInFirestore,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface WebsiteCmsPanelProps {
  admin: AdminUser;
  settings: SiteSettingsDoc;
  announcements: Announcement[];
  categories: RoomCategory[];
  floors: Floor[];
  onRefresh: () => Promise<void>;
}

export function WebsiteCmsPanel({
  admin,
  settings,
  announcements,
  categories,
  floors,
  onRefresh,
}: WebsiteCmsPanelProps) {
  const [cmsTab, setCmsTab] = useState<'GENERAL' | 'ANNOUNCEMENTS' | 'CATEGORIES'>(
    'GENERAL',
  );
  const [formState, setFormState] = useState<
    Omit<SiteSettingsDoc, 'updated_by' | 'updated_at'>
  >({
    site_title: settings.site_title,
    site_subtitle: settings.site_subtitle,
    logo_url: settings.logo_url,
    hero_heading: settings.hero_heading,
    hero_description: settings.hero_description,
    campus_address: settings.campus_address,
    contact_email: settings.contact_email,
    contact_phone: settings.contact_phone,
    check_in_time: settings.check_in_time,
    check_out_time: settings.check_out_time,
    booking_guidelines: settings.booking_guidelines,
    footer_text: settings.footer_text,
    show_designation: settings.show_designation,
    show_purpose: settings.show_purpose,
    show_special_requirements: settings.show_special_requirements,
    show_applicant_remarks: settings.show_applicant_remarks,
  });

  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annPriority, setAnnPriority] = useState<
    'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  >('NORMAL');
  const [savingAnn, setSavingAnn] = useState(false);

  const [catName, setCatName] = useState('');
  const [catBed, setCatBed] = useState<BedType>('Single');
  const [catAc, setCatAc] = useState<AcType>('AC');
  const [catCap, setCatCap] = useState(1);
  const [catDesc, setCatDesc] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => {
    setFormState({
      site_title: settings.site_title,
      site_subtitle: settings.site_subtitle,
      logo_url: settings.logo_url,
      hero_heading: settings.hero_heading,
      hero_description: settings.hero_description,
      campus_address: settings.campus_address,
      contact_email: settings.contact_email,
      contact_phone: settings.contact_phone,
      check_in_time: settings.check_in_time,
      check_out_time: settings.check_out_time,
      booking_guidelines: settings.booking_guidelines,
      footer_text: settings.footer_text,
      show_designation: settings.show_designation,
      show_purpose: settings.show_purpose,
      show_special_requirements: settings.show_special_requirements,
      show_applicant_remarks: settings.show_applicant_remarks,
    });
  }, [settings]);

  const setTextField = (
    key:
      | 'site_title'
      | 'site_subtitle'
      | 'logo_url'
      | 'hero_heading'
      | 'hero_description'
      | 'campus_address'
      | 'contact_email'
      | 'contact_phone'
      | 'check_in_time'
      | 'check_out_time'
      | 'booking_guidelines'
      | 'footer_text',
    val: string,
  ) => {
    setFormState((prev) => ({...prev, [key]: val}));
  };

  const toggleBoolField = (
    key:
      | 'show_designation'
      | 'show_purpose'
      | 'show_special_requirements'
      | 'show_applicant_remarks',
  ) => {
    setFormState((prev) => ({...prev, [key]: !prev[key]}));
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 160;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setTextField('logo_url', canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      await savePublicSiteSettings(formState, admin);
      setNotice('Website settings saved to Firebase Firestore and published.');
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    setSavingAnn(true);
    setError(null);
    setNotice(null);
    try {
      await upsertAnnouncementInFirestore(
        {
          title: annTitle.trim(),
          content: annContent.trim(),
          priority: annPriority,
          is_active: true,
        },
        admin,
      );
      setAnnTitle('');
      setAnnContent('');
      setNotice('Announcement published.');
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingAnn(false);
    }
  };

  const handleToggleAnnouncement = async (ann: Announcement) => {
    setError(null);
    try {
      await upsertAnnouncementInFirestore(
        {...ann, is_active: !ann.is_active},
        admin,
      );
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    setError(null);
    try {
      await deleteAnnouncementInFirestore(id, admin);
      setNotice('Announcement removed.');
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  const handleCreateCategory = async (e: FormEvent) => {
    e.preventDefault();
    setSavingCat(true);
    setError(null);
    setNotice(null);
    try {
      await upsertCategoryInFirestore(
        {
          category_name: catName.trim(),
          bed_type: catBed,
          ac_type: catAc,
          default_capacity: catCap,
          description: catDesc.trim(),
          is_bookable: true,
        },
        admin,
      );
      setCatName('');
      setCatDesc('');
      setNotice('Room category added.');
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSavingCat(false);
    }
  };

  const handleToggleCategoryBookable = async (cat: RoomCategory) => {
    setError(null);
    try {
      await upsertCategoryInFirestore(
        {...cat, is_bookable: !cat.is_bookable},
        admin,
      );
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  const handleUpdateFloorName = async (floor: Floor, nextName: string) => {
    if (!nextName.trim() || nextName === floor.floor_name) return;
    setError(null);
    try {
      await updateFloorInFirestore(
        floor.floor_id,
        {floor_name: nextName.trim()},
        admin,
      );
      setNotice(`Updated floor label to ${nextName.trim()}.`);
      await onRefresh();
    } catch (err) {
      setError(extractReadableError(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Website Settings &amp; CMS
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Edit website branding, logo, homepage copy, contact details, announcements, and
          booking categories in Firestore without modifying source code.
        </p>
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

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {(
          [
            ['GENERAL', 'Branding, Copy & Form Fields'],
            ['ANNOUNCEMENTS', 'Announcements'],
            ['CATEGORIES', 'Categories & Floors'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCmsTab(id)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg cursor-pointer ${
              cmsTab === id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {cmsTab === 'GENERAL' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Website Title
              </label>
              <input
                type="text"
                value={formState.site_title}
                onChange={(e) => setTextField('site_title', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Website Subtitle
              </label>
              <input
                type="text"
                value={formState.site_subtitle}
                onChange={(e) => setTextField('site_subtitle', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Logo URL (or upload below)
              </label>
              <input
                type="text"
                value={formState.logo_url}
                onChange={(e) => setTextField('logo_url', e.target.value)}
                placeholder="https://... or uploaded image"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Upload Logo Image (auto-resized)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="text-xs text-slate-600"
              />
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-200 pt-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Homepage Hero Heading
              </label>
              <input
                type="text"
                value={formState.hero_heading}
                onChange={(e) => setTextField('hero_heading', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Homepage Hero Description
              </label>
              <textarea
                rows={2}
                value={formState.hero_description}
                onChange={(e) =>
                  setTextField('hero_description', e.target.value)
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Campus Address
              </label>
              <input
                type="text"
                value={formState.campus_address}
                onChange={(e) => setTextField('campus_address', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Booking Guidelines
              </label>
              <textarea
                rows={2}
                value={formState.booking_guidelines}
                onChange={(e) =>
                  setTextField('booking_guidelines', e.target.value)
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 pt-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contact Email
              </label>
              <input
                type="email"
                value={formState.contact_email}
                onChange={(e) => setTextField('contact_email', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contact Phone
              </label>
              <input
                type="text"
                value={formState.contact_phone}
                onChange={(e) => setTextField('contact_phone', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Footer Attribution
              </label>
              <input
                type="text"
                value={formState.footer_text}
                onChange={(e) => setTextField('footer_text', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Check-In Time
              </label>
              <input
                type="text"
                value={formState.check_in_time}
                onChange={(e) => setTextField('check_in_time', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Check-Out Time
              </label>
              <input
                type="text"
                value={formState.check_out_time}
                onChange={(e) => setTextField('check_out_time', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-2">
            <div className="text-xs font-semibold text-slate-700">
              Optional Public Booking Form Fields
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              {(
                [
                  ['show_designation', 'Show Designation'],
                  ['show_purpose', 'Show Purpose of Visit'],
                  ['show_special_requirements', 'Show Special Requirements'],
                  ['show_applicant_remarks', 'Show Additional Remarks'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="inline-flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={formState[key]}
                    onChange={() => toggleBoolField(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {savingSettings ? 'Saving Settings...' : 'Save Website Settings'}
            </button>
          </div>
        </form>
      )}

      {cmsTab === 'ANNOUNCEMENTS' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateAnnouncement}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Publish Announcement
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Priority
                </label>
                <select
                  value={annPriority}
                  onChange={(e) =>
                    setAnnPriority(
                      e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="LOW">LOW</option>
                  <option value="NORMAL">NORMAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Content *
              </label>
              <textarea
                rows={2}
                required
                value={annContent}
                onChange={(e) => setAnnContent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingAnn}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingAnn ? 'Publishing...' : 'Add Announcement'}
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {announcements.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center">
                No announcements.
              </div>
            ) : (
              announcements.map((ann) => (
                <div
                  key={ann.announcement_id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="font-semibold text-sm text-slate-900">
                      {ann.title} ·{' '}
                      <span className="text-xs font-mono text-slate-500">
                        {ann.priority}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{ann.content}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleAnnouncement(ann)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                        ann.is_active
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {ann.is_active ? 'Visible' : 'Hidden'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteAnnouncement(ann.announcement_id)
                      }
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      aria-label="Delete announcement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {cmsTab === 'CATEGORIES' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateCategory}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Add Booking Category
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bed Type
                </label>
                <select
                  value={catBed}
                  onChange={(e) => setCatBed(e.target.value as BedType)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Single">Single</option>
                  <option value="Double">Double</option>
                  <option value="Queen Size">Queen Size</option>
                  <option value="VIP">VIP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  AC Type
                </label>
                <select
                  value={catAc}
                  onChange={(e) => setCatAc(e.target.value as AcType)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="AC">AC</option>
                  <option value="Non-AC">Non-AC</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  value={catCap}
                  onChange={(e) =>
                    setCatCap(Math.max(1, Number(e.target.value)))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCat}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
              >
                {savingCat ? 'Adding...' : 'Add Category'}
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {categories.map((c) => (
              <div
                key={c.category_id}
                className="p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-semibold text-sm text-slate-900">
                    {c.category_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.bed_type} · {c.ac_type} · Capacity {c.default_capacity}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleCategoryBookable(c)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    c.is_bookable
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {c.is_bookable
                    ? 'Shown on Public Form'
                    : 'Hidden on Public Form'}
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Floor Labels</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {floors.map((f) => (
                <div key={f.floor_id} className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue={f.floor_name}
                    onBlur={(e) =>
                      void handleUpdateFloorName(f, e.target.value)
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

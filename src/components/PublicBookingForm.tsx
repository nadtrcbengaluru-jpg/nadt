import {useEffect, useRef, useState, type FormEvent} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Printer,
  Search,
  Users,
  X,
} from 'lucide-react';
import type {RoomCategory} from '../types/database.ts';
import {
  submitPublicBookingsBatch,
  type PublicBookingPayload,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';
import {
  saveApplicantReceipts,
  type SavedApplicantReceipt,
} from '../lib/localBookingReceipts.ts';

interface PublicBookingFormProps {
  categories: RoomCategory[];
  showDesignation?: boolean;
  showPurpose?: boolean;
  showSpecialRequirements?: boolean;
  showApplicantRemarks?: boolean;
  onTrackStatus?: (bookingRef: string) => void;
  onReceiptsCreated?: (receipts: SavedApplicantReceipt[]) => void;
}

interface AdditionalGuestEntry {
  full_name: string;
  designation: string;
  preferred_category: string;
}

function addOneDay(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return ymd;
  dt.setDate(dt.getDate() + 1);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function PublicBookingForm({
  categories,
  showDesignation = true,
  showPurpose = true,
  showSpecialRequirements = true,
  showApplicantRemarks = true,
  onTrackStatus,
  onReceiptsCreated,
}: PublicBookingFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const defaultCat = categories[0]?.category_name || 'Single Non-AC';

  const [applicantName, setApplicantName] = useState('');
  const [organization, setOrganization] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [purpose, setPurpose] = useState('');
  const [checkInDate, setCheckInDate] = useState(today);
  const [checkOutDate, setCheckOutDate] = useState(tomorrow);
  const [numPersons, setNumPersons] = useState(1);
  const [preferredCategory, setPreferredCategory] = useState(defaultCat);
  const [roomsRequired, setRoomsRequired] = useState(1);
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [applicantRemarks, setApplicantRemarks] = useState('');

  // Multi-person individual booking reference number support
  const [separateRefPerPerson, setSeparateRefPerPerson] = useState(true);
  const [additionalGuests, setAdditionalGuests] = useState<AdditionalGuestEntry[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<SavedApplicantReceipt[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const receiptCardRef = useRef<HTMLDivElement | null>(null);

  // Sync additional guest rows whenever numPersons changes (up to 10 individual refs per submission)
  const individualGuestCount = Math.min(numPersons, 10);
  useEffect(() => {
    const extraCount = Math.max(0, individualGuestCount - 1);
    setAdditionalGuests((prev) => {
      if (prev.length === extraCount) return prev;
      if (prev.length > extraCount) return prev.slice(0, extraCount);
      const added: AdditionalGuestEntry[] = [];
      for (let i = prev.length; i < extraCount; i++) {
        added.push({
          full_name: '',
          designation: '',
          preferred_category: preferredCategory || defaultCat,
        });
      }
      return [...prev, ...added];
    });
  }, [individualGuestCount, preferredCategory, defaultCat]);

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard API unavailable in restricted iframe
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (checkInDate >= checkOutDate) {
      setError('Check-out date must be after check-in date.');
      return;
    }

    const usePerPersonRefs =
      numPersons > 1 && numPersons <= 10 && separateRefPerPerson;

    const payloads: PublicBookingPayload[] = [];
    const baseCommon = {
      organization: organization.trim(),
      email: email.trim(),
      mobile: mobile.trim(),
      purpose: purpose.trim() || 'Official Visit',
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      special_requirements: specialRequirements.trim(),
      applicant_remarks: applicantRemarks.trim(),
    };

    if (usePerPersonRefs) {
      // Person 1 (Primary Applicant)
      payloads.push({
        ...baseCommon,
        applicant_name: applicantName.trim(),
        designation: designation.trim(),
        preferred_category: preferredCategory,
        num_persons: 1,
        rooms_required: 1,
      });

      // Persons 2..N
      for (let i = 0; i < additionalGuests.length; i++) {
        const guest = additionalGuests[i];
        const guestName = guest.full_name.trim();
        if (!guestName) {
          setError(
            `Please enter the full name for Person ${i + 2} to generate their Booking Reference Number.`,
          );
          return;
        }
        payloads.push({
          ...baseCommon,
          applicant_name: guestName,
          designation: guest.designation.trim() || designation.trim(),
          preferred_category: guest.preferred_category || preferredCategory,
          num_persons: 1,
          rooms_required: 1,
        });
      }
    } else {
      payloads.push({
        ...baseCommon,
        applicant_name: applicantName.trim(),
        designation: designation.trim(),
        preferred_category: preferredCategory,
        num_persons: numPersons,
        rooms_required: roomsRequired,
      });
    }

    setSubmitting(true);
    try {
      const created = await submitPublicBookingsBatch(payloads);
      const savedList: SavedApplicantReceipt[] = created.map((rec, idx) => ({
        booking_id: rec.booking_id,
        booking_ref: rec.booking_ref,
        applicant_name: rec.applicant_name,
        organization: payloads[idx].organization,
        check_in_date: payloads[idx].check_in_date,
        check_out_date: payloads[idx].check_out_date,
        preferred_category: payloads[idx].preferred_category,
        rooms_required: payloads[idx].rooms_required,
        num_persons: payloads[idx].num_persons,
        status: rec.status,
        created_at: rec.created_at,
      }));

      saveApplicantReceipts(savedList);
      onReceiptsCreated?.(savedList);

      setReceipts(savedList);
      setShowConfirmModal(true);

      // Clear form inputs for next submission
      setApplicantName('');
      setOrganization('');
      setDesignation('');
      setEmail('');
      setMobile('');
      setPurpose('');
      setNumPersons(1);
      setRoomsRequired(1);
      setAdditionalGuests([]);
      setSpecialRequirements('');
      setApplicantRemarks('');

      // Ensure confirmation card is visible behind/after closing modal
      window.setTimeout(() => {
        receiptCardRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 60);
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (receipts.length > 0) {
    const allRefsSummary = receipts
      .map((r) => `${r.applicant_name}: ${r.booking_ref}`)
      .join('\n');

    return (
      <>
        <div
          ref={receiptCardRef}
          className="bg-white border-2 border-emerald-500 rounded-xl p-6 sm:p-8 space-y-6"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                {receipts.length > 1
                  ? `${receipts.length} Booking Requests Submitted — Individual Reference Numbers Issued`
                  : 'Booking Request Submitted — Reference Number Issued'}
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Save your Booking Reference Number{receipts.length > 1 ? 's' : ''} below to
                check approval status and room allotment anytime without logging in.
              </p>
            </div>
          </div>

          {/* Highlighted Booking Reference Number(s) */}
          {receipts.length === 1 ? (
            <div className="bg-[#0F2942] text-white rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-300">
                  Your Booking Reference Number ({receipts[0].applicant_name})
                </div>
                <div className="font-mono font-bold text-2xl sm:text-3xl tracking-wide text-amber-300 mt-1 select-all">
                  {receipts[0].booking_ref}
                </div>
                <div className="text-xs text-slate-300 mt-2 font-mono tabular-nums">
                  {receipts[0].check_in_date} → {receipts[0].check_out_date} ·{' '}
                  {receipts[0].preferred_category} · Status: {receipts[0].status}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void handleCopyText(receipts[0].booking_ref, receipts[0].booking_ref)
                  }
                  className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-white hover:bg-slate-100 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedKey === receipts[0].booking_ref ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Reference
                    </>
                  )}
                </button>
                {onTrackStatus && (
                  <button
                    type="button"
                    onClick={() => onTrackStatus(receipts[0].booking_ref)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Check Status
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Booking Person</th>
                    <th className="py-3 px-4">Booking Reference Number</th>
                    <th className="py-3 px-4">Category &amp; Stay</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {receipts.map((rec, idx) => (
                    <tr key={rec.booking_ref} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {rec.applicant_name}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-[#0F2942] select-all whitespace-nowrap">
                        {rec.booking_ref}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                        {rec.preferred_category} · {rec.check_in_date} → {rec.check_out_date}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyText(rec.booking_ref, rec.booking_ref)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                          >
                            {copiedKey === rec.booking_ref ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy
                              </>
                            )}
                          </button>
                          {onTrackStatus && (
                            <button
                              type="button"
                              onClick={() => onTrackStatus(rec.booking_ref)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded cursor-pointer"
                            >
                              Track
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
            {receipts.length > 1 && (
              <button
                type="button"
                onClick={() => void handleCopyText(allRefsSummary, 'ALL')}
                className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copiedKey === 'ALL' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    All References Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy All Reference Numbers
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Confirmation Slip
            </button>
            <button
              type="button"
              onClick={() => {
                setReceipts([]);
                setShowConfirmModal(false);
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
            >
              Submit Another Request
            </button>
          </div>
        </div>

        {/* Centered High-Visibility Booking Reference Modal */}
        {showConfirmModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-ref-modal-title"
            className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          >
            <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden">
              <div className="bg-[#0F2942] text-white px-6 py-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 id="booking-ref-modal-title" className="text-lg font-bold">
                      Booking Reference Number{receipts.length > 1 ? 's' : ''} Generated
                    </h4>
                    <p className="text-xs text-slate-300 mt-1">
                      Please note down or copy {receipts.length > 1 ? 'these reference numbers' : 'this reference number'} to track room allotment status.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  aria-label="Close confirmation dialog"
                  className="p-1 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {receipts.map((rec) => (
                    <div
                      key={rec.booking_ref}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-slate-500">
                          Applicant: <strong className="text-slate-900">{rec.applicant_name}</strong>
                        </div>
                        <div className="font-mono font-bold text-xl text-[#0F2942] tracking-wide mt-0.5 select-all">
                          {rec.booking_ref}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                          {rec.check_in_date} → {rec.check_out_date} · {rec.preferred_category}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText(rec.booking_ref, `modal-${rec.booking_ref}`)
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-[#0F2942] bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-center"
                      >
                        {copiedKey === `modal-${rec.booking_ref}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Ref
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                  {onTrackStatus && receipts.length === 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowConfirmModal(false);
                        onTrackStatus(receipts[0].booking_ref);
                      }}
                      className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Track Live Status
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="px-5 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
    >
      <div className="border-b border-slate-200 pb-4">
        <h3 className="text-xl font-bold text-slate-900">Room Booking Request Form</h3>
        <p className="text-sm text-slate-600 mt-1">
          No login or account creation is required. A unique{' '}
          <strong>Booking Reference Number</strong> is generated immediately upon submission
          for each booking person.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            {numPersons > 1 && numPersons <= 10 && separateRefPerPerson
              ? 'Person 1 — Primary Applicant Full Name *'
              : 'Applicant Full Name *'}
          </label>
          <input
            type="text"
            required
            value={applicantName}
            onChange={(e) => setApplicantName(e.target.value)}
            placeholder="Full name of officer / guest"
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Organisation / Department *
          </label>
          <input
            type="text"
            required
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="e.g. Income Tax Department / NADT"
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        {showDesignation && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Designation</label>
            <input
              type="text"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Joint Commissioner / Trainee"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Email Address *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@department.gov.in"
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Mobile Number *</label>
          <input
            type="tel"
            required
            minLength={5}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="+91 98XXXXXXXX"
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        {showPurpose && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Purpose of Visit *
            </label>
            <input
              type="text"
              required
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Training programme, seminar, official duty"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Check-in Date *</label>
          <input
            type="date"
            required
            value={checkInDate}
            onChange={(e) => {
              const nextIn = e.target.value;
              setCheckInDate(nextIn);
              if (nextIn && (!checkOutDate || checkOutDate <= nextIn)) {
                setCheckOutDate(addOneDay(nextIn));
              }
            }}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Check-out Date *
          </label>
          <input
            type="date"
            required
            value={checkOutDate}
            min={addOneDay(checkInDate)}
            onChange={(e) => setCheckOutDate(e.target.value)}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Preferred Room Category *
          </label>
          <select
            value={preferredCategory}
            onChange={(e) => setPreferredCategory(e.target.value)}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F2942]"
          >
            {categories.map((cat) => (
              <option key={cat.category_id} value={cat.category_name}>
                {cat.category_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Number of Persons *
          </label>
          <input
            type="number"
            min={1}
            max={50}
            required
            value={numPersons}
            onChange={(e) => setNumPersons(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Number of Rooms Required *
          </label>
          <input
            type="number"
            min={1}
            max={20}
            required
            disabled={numPersons > 1 && numPersons <= 10 && separateRefPerPerson}
            value={
              numPersons > 1 && numPersons <= 10 && separateRefPerPerson
                ? numPersons
                : roomsRequired
            }
            onChange={(e) => setRoomsRequired(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:border-[#0F2942]"
          />
        </div>
      </div>

      {/* Multi-person individual Booking Reference Number section */}
      {numPersons > 1 && numPersons <= 10 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Users className="w-4 h-4 text-[#0F2942] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Individual Booking Reference Number per Person
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Each person listed below receives their own unique Booking Reference Number
                  to track room allotment independently.
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={separateRefPerPerson}
                onChange={(e) => setSeparateRefPerPerson(e.target.checked)}
                className="rounded border-slate-300"
              />
              Separate reference for each person
            </label>
          </div>

          {separateRefPerPerson && additionalGuests.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              {additionalGuests.map((guest, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Person {idx + 2} — Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={guest.full_name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdditionalGuests((prev) =>
                          prev.map((item, i) =>
                            i === idx ? {...item, full_name: val} : item,
                          ),
                        );
                      }}
                      placeholder={`Full name of Person ${idx + 2}`}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Person {idx + 2} — Designation
                    </label>
                    <input
                      type="text"
                      value={guest.designation}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdditionalGuests((prev) =>
                          prev.map((item, i) =>
                            i === idx ? {...item, designation: val} : item,
                          ),
                        );
                      }}
                      placeholder="Optional designation"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Person {idx + 2} — Room Category
                    </label>
                    <select
                      value={guest.preferred_category}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdditionalGuests((prev) =>
                          prev.map((item, i) =>
                            i === idx ? {...item, preferred_category: val} : item,
                          ),
                        );
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
                    >
                      {categories.map((cat) => (
                        <option key={cat.category_id} value={cat.category_name}>
                          {cat.category_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {showSpecialRequirements && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Special Requirements
            </label>
            <textarea
              rows={2}
              value={specialRequirements}
              onChange={(e) => setSpecialRequirements(e.target.value)}
              placeholder="Ground floor accessibility, adjoining rooms, etc."
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
            />
          </div>
        )}

        {showApplicantRemarks && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Additional Remarks
            </label>
            <textarea
              rows={2}
              value={applicantRemarks}
              onChange={(e) => setApplicantRemarks(e.target.value)}
              placeholder="Arrival time or additional details"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          Submitted requests enter review as <strong>PENDING</strong> and immediately display a
          unique <strong>Booking Reference Number</strong>{' '}
          {numPersons > 1 && numPersons <= 10 && separateRefPerPerson
            ? `for each of the ${numPersons} persons.`
            : 'for status tracking.'}
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
        >
          {submitting
            ? 'Generating Reference Number...'
            : numPersons > 1 && numPersons <= 10 && separateRefPerPerson
              ? `Submit & Issue ${numPersons} Reference Numbers`
              : 'Submit & Get Reference Number'}
        </button>
      </div>
    </form>
  );
}

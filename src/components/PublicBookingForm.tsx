import {useState, type FormEvent} from 'react';
import {AlertCircle, CheckCircle2, Printer} from 'lucide-react';
import type {RoomCategory} from '../types/database.ts';
import {
  submitPublicBooking,
  type PublicBookingReceipt,
} from '../lib/firestoreDb.ts';
import {extractReadableError} from '../lib/firestoreError.ts';

interface PublicBookingFormProps {
  categories: RoomCategory[];
  showDesignation?: boolean;
  showPurpose?: boolean;
  showSpecialRequirements?: boolean;
  showApplicantRemarks?: boolean;
}

export function PublicBookingForm({
  categories,
  showDesignation = true,
  showPurpose = true,
  showSpecialRequirements = true,
  showApplicantRemarks = true,
}: PublicBookingFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [applicantName, setApplicantName] = useState('');
  const [organization, setOrganization] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [purpose, setPurpose] = useState('');
  const [checkInDate, setCheckInDate] = useState(today);
  const [checkOutDate, setCheckOutDate] = useState(tomorrow);
  const [numPersons, setNumPersons] = useState(1);
  const [preferredCategory, setPreferredCategory] = useState(
    categories[0]?.category_name || 'Single Non-AC',
  );
  const [roomsRequired, setRoomsRequired] = useState(1);
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [applicantRemarks, setApplicantRemarks] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicBookingReceipt | null>(null);
  const [submittedSummary, setSubmittedSummary] = useState<{
    name: string;
    checkIn: string;
    checkOut: string;
    category: string;
    rooms: number;
  } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (checkInDate >= checkOutDate) {
      setError('Check-out date must be after check-in date.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitPublicBooking({
        applicant_name: applicantName.trim(),
        organization: organization.trim(),
        designation: designation.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        purpose: purpose.trim() || 'Official Visit',
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        num_persons: numPersons,
        preferred_category: preferredCategory,
        rooms_required: roomsRequired,
        special_requirements: specialRequirements.trim(),
        applicant_remarks: applicantRemarks.trim(),
      });
      setSubmittedSummary({
        name: applicantName.trim(),
        checkIn: checkInDate,
        checkOut: checkOutDate,
        category: preferredCategory,
        rooms: roomsRequired,
      });
      setReceipt(res);
      setApplicantName('');
      setOrganization('');
      setDesignation('');
      setEmail('');
      setMobile('');
      setPurpose('');
      setSpecialRequirements('');
      setApplicantRemarks('');
    } catch (err) {
      setError(extractReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (receipt && submittedSummary) {
    return (
      <div className="bg-white border border-emerald-300 rounded-xl p-8 space-y-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-xl font-bold text-slate-900">
              Booking Request Submitted (Pending Review)
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Your accommodation request has been recorded and forwarded to Campus Administration.
              Rooms are allocated only after administrative verification and approval.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500">Booking Reference Number</div>
            <div className="font-mono font-bold text-base text-[#0F2942] mt-0.5">
              {receipt.booking_ref}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Current Status</div>
            <div className="font-semibold text-amber-800 mt-0.5">{receipt.status}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Applicant</div>
            <div className="font-medium text-slate-900 mt-0.5">{submittedSummary.name}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Check-in / Check-out</div>
            <div className="font-mono text-slate-900 mt-0.5">
              {submittedSummary.checkIn} to {submittedSummary.checkOut}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Preferred Category</div>
            <div className="font-medium text-slate-900 mt-0.5">{submittedSummary.category}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Rooms Requested</div>
            <div className="font-mono text-slate-900 mt-0.5">{submittedSummary.rooms}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Confirmation
          </button>
          <button
            type="button"
            onClick={() => {
              setReceipt(null);
              setSubmittedSummary(null);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] rounded-lg cursor-pointer"
          >
            Submit Another Request
          </button>
        </div>
      </div>
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
          No login or account creation is required. Complete all required fields below to submit
          a request.
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
            Applicant Full Name *
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
            onChange={(e) => setCheckInDate(e.target.value)}
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
            min={checkInDate}
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
            onChange={(e) => setNumPersons(Math.max(1, Number(e.target.value)))}
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
            value={roomsRequired}
            onChange={(e) => setRoomsRequired(Math.max(1, Number(e.target.value)))}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F2942]"
          />
        </div>
      </div>

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
          Submitted requests enter review as <strong>PENDING</strong> and do not auto-assign
          rooms.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-[#0F2942] hover:bg-[#173a5c] disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
        >
          {submitting ? 'Submitting Request...' : 'Submit Booking Request'}
        </button>
      </div>
    </form>
  );
}

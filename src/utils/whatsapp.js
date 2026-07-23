// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Center — frontend-only helpers.
// No backend calls, no new APIs. Pure functions that operate on the member
// data already returned by membersAPI.list() (same shape used in
// MemberList.jsx / Dashboard.jsx) plus the renewal-date math that already
// lives in utils/renewal.js.
// ─────────────────────────────────────────────────────────────────────────────

import { format } from "date-fns";
import { getDaysLeft } from "./renewal";

export const LANGUAGE_OPTS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "both", label: "Hindi + English" },
];

// Local-only preference (frontend storage, not a backend field) so the owner
// doesn't have to retype the gym name every time they open the page.
const GYM_NAME_KEY = "gymops_whatsapp_gym_name";

export function loadSavedGymName() {
  try {
    return localStorage.getItem(GYM_NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function saveGymName(name) {
  try {
    localStorage.setItem(GYM_NAME_KEY, name || "");
  } catch {
    /* ignore storage errors */
  }
}

/**
 * A member is "renewing soon" for WhatsApp purposes when their renewal date
 * (same field MemberList/Dashboard already use: renewal_date, falling back
 * to expiry_date if that's what the record has) is between today and 7 days
 * from now, inclusive. Already-expired members are excluded — this screen is
 * for the "about to expire" reminder, not overdue collection.
 */
export function getExpiryDate(member) {
  return member.renewal_date || member.expiry_date || null;
}

export function isExpiringWithin7Days(member) {
  const expiryDate = getExpiryDate(member);
  if (!expiryDate) return false;
  const days = getDaysLeft(expiryDate);
  return days !== null && days >= 0 && days <= 7;
}

export function filterExpiringMembers(members) {
  return (members || []).filter(isExpiringWithin7Days);
}

/**
 * Best-effort read of a pending/due fee amount from a member record.
 * The Members API doesn't guarantee a specific field name for this, so we
 * defensively check the common variants and only show it if one is present
 * — matching the "Pending Fees (if available)" requirement without adding
 * any new API or backend field.
 */
export function getPendingFees(member) {
  const candidates = [
    member.pending_fee,
    member.pending_fees,
    member.due_amount,
    member.fees_due,
    member.balance_due,
    member.outstanding_amount,
    member.due_fee,
  ];
  const found = candidates.find((v) => v !== undefined && v !== null && v !== "");
  if (found === undefined) return null;
  const num = Number(found);
  return Number.isNaN(num) ? null : num;
}

export function getPlanName(member) {
  return member.plan?.name || member.plan_name || "—";
}

function formatExpiry(expiryDate) {
  if (!expiryDate) return "—";
  try {
    return format(new Date(expiryDate), "dd MMM yyyy");
  } catch {
    return expiryDate;
  }
}

// ── Templates ────────────────────────────────────────────────────────────────
// Kept as plain template strings (not JSX) so they're trivial to send as-is
// through the wa.me text param, and easy for the owner to hand-edit afterward.

function englishTemplate({ memberName, gymName, daysLeft, planName, fees }) {
  return `Hello ${memberName},
Your membership at ${gymName} will expire in ${daysLeft} days.
Plan:
${planName}
Remaining Fee:
₹${fees}

Please renew your membership to continue your workouts.

Thank you,
${gymName}`;
}

function hindiTemplate({ memberName, gymName, daysLeft, planName, fees }) {
  return `नमस्ते ${memberName},
आपकी सदस्यता ${daysLeft} दिनों में समाप्त होने वाली है।
प्लान:
${planName}
शेष फीस:
₹${fees}

कृपया समय पर अपनी सदस्यता रिन्यू करें।

धन्यवाद
${gymName}`;
}

function bilingualTemplate(vars) {
  return `${englishTemplate(vars)}
---------------------------------
${hindiTemplate(vars)}`;
}

/**
 * Build the auto-generated message for one member. `gymName` is supplied by
 * the owner in the modal (frontend-only input — the Members/Auth API doesn't
 * expose a gym name field), everything else comes straight off the member
 * record and the existing renewal-date helpers.
 */
export function generateMessage({ member, language, gymName }) {
  const expiryDate = getExpiryDate(member);
  const daysLeft = getDaysLeft(expiryDate);
  const fees = getPendingFees(member);

  const vars = {
    memberName: member.name || "Member",
    gymName: gymName?.trim() || "Our Gym",
    daysLeft: daysLeft === null ? "—" : daysLeft,
    planName: getPlanName(member),
    fees: fees === null ? "0" : fees,
    expiryDate: formatExpiry(expiryDate),
  };

  if (language === "hi") return hindiTemplate(vars);
  if (language === "both") return bilingualTemplate(vars);
  return englishTemplate(vars);
}

/**
 * Normalize an Indian mobile number for wa.me: digits only, and prefix the
 * "91" country code when the number looks like a bare 10-digit local number
 * (the shape phone numbers are stored in throughout this app, e.g. Payments/
 * Members forms use a plain `tel` input with no country code). Numbers that
 * already include a country code (11+ digits) are left as-is.
 */
export function formatPhoneForWhatsApp(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function buildWhatsAppUrl(phone, message) {
  const digits = formatPhoneForWhatsApp(phone);
  const encoded = encodeURIComponent(message || "");
  return `https://wa.me/${digits}?text=${encoded}`;
}

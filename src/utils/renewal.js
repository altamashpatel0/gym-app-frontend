// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for plan-duration → renewal-date → countdown logic.
// Every screen (MemberList, PaymentList, Dashboard, …) must import from here
// instead of recalculating renewal dates or "days left" locally.
//
// IMPORTANT: the day-based numbers in DURATION_DAYS_BY_MONTHS are an internal
// calculation detail only. The UI must keep showing plans as "1 Month",
// "3 Months", "6 Months", "1 Year" — never "30 Days" / "90 Days" / "180 Days"
// / "365 Days". Nothing in this file renders text to the user; it only
// produces dates and day-counts for the existing UI components to display.
// ─────────────────────────────────────────────────────────────────────────────

import { differenceInDays, addDays, format } from "date-fns";

// Internal month → day mapping used ONLY for date math.
const DURATION_DAYS_BY_MONTHS = {
  1: 30,
  3: 90,
  6: 180,
  12: 365,
};

/**
 * Resolve the internal day-count for a plan duration (in months).
 * Standard plans (1/3/6/12 months) use the fixed mapping above so renewal
 * dates are 100% consistent everywhere. Any non-standard duration falls back
 * to months * 30 rather than silently breaking.
 */
export function getPlanDurationDays(durationMonths) {
  const months = Number(durationMonths);
  if (!months || months <= 0) return null;
  return DURATION_DAYS_BY_MONTHS[months] ?? Math.round(months * 30);
}

/**
 * Renewal date = join_date + duration_days (NEVER month-based arithmetic).
 * Pass the plan's `duration_months` (the same field already returned by the
 * plans API / used in PlanList) — not the plan's display name.
 */
export function calcRenewalDate(joinDate, durationMonths) {
  if (!joinDate || !durationMonths) return "";
  const days = getPlanDurationDays(durationMonths);
  if (!days) return "";
  const result = addDays(new Date(joinDate), days);
  return format(result, "yyyy-MM-dd");
}

// Midnight "today", so a countdown computed at 11:59pm and one computed at
// 12:01am the same calendar day always agree — this is what previously made
// the countdown "freeze" or jump depending on time-of-day and on which
// component's copy of the logic happened to run.
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * THE single countdown function. Signed days remaining until renewal
 * (negative = already expired). Always differenceInDays(renewal, today),
 * both normalized to midnight.
 */
export function getDaysRemaining(renewalDate) {
  if (!renewalDate) return null;
  const renewal = new Date(renewalDate);
  renewal.setHours(0, 0, 0, 0);
  return differenceInDays(renewal, startOfToday());
}

/**
 * Shared member-status classification (active / expiring_soon / expired).
 * Used by MemberList and Dashboard so a member is never "active" in one
 * screen and "expiring soon" in another.
 */
export function getMemberStatus(member) {
  if (member.status === "expired") return "expired";
  if (member.status === "active" && member.renewal_date) {
    const days = getDaysRemaining(member.renewal_date);
    if (days < 0) return "expired";
    if (days <= 7) return "expiring_soon";
  }
  return member.status || "active";
}

/**
 * Label + text color for a renewal countdown (used in MemberList rows/cards).
 */
export function getRenewalInfo(renewalDate) {
  const days = getDaysRemaining(renewalDate);
  if (days === null) return null;

  let label;
  if (days > 1) label = `${days} days left`;
  else if (days === 1) label = "Tomorrow";
  else if (days === 0) label = "Today expires";
  else label = `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`;

  let cls;
  if (days > 15) cls = "text-green-400";
  else if (days >= 7) cls = "text-yellow-400";
  else if (days >= 0) cls = "text-orange-400";
  else cls = "text-red-400";

  return { label, cls };
}

/**
 * Days-left helper for screens that just need the plain number
 * (e.g. Dashboard's "Expiring Soon" table). Same underlying countdown.
 */
export function getDaysLeft(renewalDate) {
  return getDaysRemaining(renewalDate);
}

/**
 * Overdue days for pending-dues views (PaymentList). Never negative.
 */
export function getOverdueDays(renewalDate) {
  const days = getDaysRemaining(renewalDate);
  if (days === null) return 0;
  return Math.max(0, -days);
}

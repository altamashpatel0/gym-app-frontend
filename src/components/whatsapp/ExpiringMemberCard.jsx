import { useState } from "react";
import { Phone } from "lucide-react";
import { getDaysLeft } from "../../utils/renewal";
import { getExpiryDate, getPendingFees, getPlanName } from "../../utils/whatsapp";
import { format } from "date-fns";

// Small local avatar — mirrors MemberAvatar in MemberList.jsx (initials
// fallback + photo_url) without importing from that page, so this component
// stays self-contained and reusable.
function Avatar({ member }) {
  const [imgError, setImgError] = useState(false);
  const initials = member.name
    ? member.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  if (member.photo_url && !imgError) {
    return (
      <img
        src={member.photo_url}
        alt={member.name}
        className="w-11 h-11 rounded-full object-cover shrink-0 border border-surface-border"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-brand-400">{initials}</span>
    </div>
  );
}

function DaysLeftBadge({ days }) {
  if (days === null || days === undefined) return null;
  const isToday = days === 0;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap ${
        isToday
          ? "bg-red-500/15 text-red-400 border border-red-500/20"
          : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
      }`}
    >
      {isToday ? "Expires Today" : `${days} Day${days === 1 ? "" : "s"} Left`}
    </span>
  );
}

export function ExpiringMemberCard({ member, checked, onToggle }) {
  const expiryDate = getExpiryDate(member);
  const daysLeft = getDaysLeft(expiryDate);
  const fees = getPendingFees(member);
  const planName = getPlanName(member);

  return (
    <label
      className={`card flex items-start gap-3 cursor-pointer transition-colors ${
        checked ? "border-brand-500/50 bg-brand-500/5" : "hover:border-surface-border/80"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(member.id)}
        className="mt-1 w-4 h-4 shrink-0 accent-brand-500 cursor-pointer"
      />
      <Avatar member={member} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white truncate">{member.name}</p>
          <DaysLeftBadge days={daysLeft} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
          <Phone size={11} /> {member.phone || "—"}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Plan: <span className="text-gray-300">{planName}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Expiry: <span className="text-gray-300">{expiryDate ? format(new Date(expiryDate), "dd MMM yyyy") : "—"}</span>
        </p>
        {fees !== null && (
          <p className="text-xs text-gray-500 mt-0.5">
            Pending Fees: <span className="text-red-400 font-medium">₹{fees}</span>
          </p>
        )}
      </div>
    </label>
  );
}

export default ExpiringMemberCard;

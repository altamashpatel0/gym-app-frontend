import { X, Loader2 } from "lucide-react";

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({ children, variant = "primary", loading, className = "", ...props }) {
  const base = "btn-" + variant;
  return (
    <button className={`${base} flex items-center gap-2 ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE = {
  active:   "bg-green-500/15 text-green-400 border border-green-500/20",
  expired:  "bg-red-500/15 text-red-400 border border-red-500/20",
  paused:   "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
  cash:     "bg-gray-500/15 text-gray-300 border border-gray-500/20",
  upi:      "bg-purple-500/15 text-purple-400 border border-purple-500/20",
  card:     "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  bank:     "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  owner:    "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
  admin:    "bg-brand-500/15 text-brand-400 border border-brand-500/20",
  staff:    "bg-gray-500/15 text-gray-300 border border-gray-500/20",
  trainer:  "bg-green-500/15 text-green-400 border border-green-500/20",
};

export function Badge({ label, type }) {
  const cls = BADGE[type] || BADGE.staff;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${cls}`}>
      {label || type}
    </span>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────
export function StatCard({ title, value, icon: Icon, color = "brand", sub }) {
  const colors = {
    brand:  "bg-brand-500/15 text-brand-400",
    green:  "bg-green-500/15 text-green-400",
    yellow: "bg-yellow-500/15 text-yellow-400",
    red:    "bg-red-500/15 text-red-400",
  };
  const iconCls = colors[color] || colors.brand;
  return (
    <div className="card flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative bg-surface-card border border-surface-border rounded-xl w-full ${width} shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border shrink-0">
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder = "Search…" }) {
  return (
    <input
      type="text"
      className="input max-w-xs"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({ page, total, limit, onPage }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 mt-4 justify-end">
      <button
        className="btn-secondary px-3 py-1.5 text-xs"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        Prev
      </button>
      <span className="text-xs text-gray-400">{page} / {pages}</span>
      <button
        className="btn-secondary px-3 py-1.5 text-xs"
        disabled={page === pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, message }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirm" width="max-w-sm">
      <p className="text-sm text-gray-300 mb-5">{message}</p>
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Confirm</Button>
      </div>
    </Modal>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────
export function FormField({ label, error, children, className = "" }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
export function Select({ options, className = "", ...props }) {
  return (
    <select
      className={`input ${className}`}
      style={{ WebkitAppearance: "none" }}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface-card">
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ message = "No data found" }) {
  return (
    <div className="py-12 text-center text-gray-500 text-sm">{message}</div>
  );
}

// ── Loading spinner ───────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 size={24} className="animate-spin text-brand-500" />
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
// Generic pulsing placeholder block. Pass className to control size/shape,
// e.g. <Skeleton className="w-16 h-16 rounded-full" /> for an avatar.
export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse bg-surface-muted rounded-md ${className}`} />;
}

// ── ErrorState ────────────────────────────────────────────────────────────────
// Shared "something went wrong" panel with an optional retry action, used by
// any screen that loads data from the API and wants a consistent error UI.
export function ErrorState({ message = "Something went wrong", onRetry }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-red-400 mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs px-4 py-1.5">
          Try again
        </button>
      )}
    </div>
  );
}

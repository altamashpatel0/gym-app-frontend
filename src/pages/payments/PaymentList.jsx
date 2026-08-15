import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Plus, AlertCircle, Edit2, Trash2, CreditCard, FileSpreadsheet,
  Search, Eye, Phone, Calendar, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  Button, Modal, Badge, FormField, Select, EmptyState, ConfirmDialog, Skeleton, ErrorState,
} from "../../components/ui/index";
import { paymentsAPI, membersAPI, plansAPI } from "../../api/client";
import { format, isAfter, isBefore, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";
import { exportToExcel } from "../../utils/exportExcel";
import { calcRenewalDate, getOverdueDays } from "../../utils/renewal";
import { MemberPhoto } from "../../components/ui/MemberPhoto";

const MODE_OPTS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
];

const FILTER_OPTS = [
  { value: "all", label: "All" },
  { value: "this_month", label: "This Month" },
  { value: "expired", label: "Expired" },
  { value: "pending", label: "Pending" },
];

const EMPTY_FORM = {
  member_id: "", plan_id: "", amount: "", payment_mode: "cash",
  note: "", valid_from: format(new Date(), "yyyy-MM-dd"), valid_to: ""
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Membership status derived purely from a payment's own valid_to — same
// "active window" concept the old table implied via its Validity column,
// just made explicit as a badge.
function membershipStatus(validTo) {
  if (!validTo) return { label: "No Expiry", dot: "bg-gray-400", cls: "bg-gray-500/15 text-gray-400 border border-gray-500/20" };
  const now = new Date();
  const to = new Date(validTo);
  if (isBefore(to, now)) {
    return { label: "Expired", dot: "bg-red-400", cls: "bg-red-500/15 text-red-400 border border-red-500/20" };
  }
  const daysLeft = differenceInCalendarDays(to, now);
  if (daysLeft <= 7) {
    return { label: "Due Soon", dot: "bg-yellow-400", cls: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20" };
  }
  return { label: "Active", dot: "bg-green-400", cls: "bg-green-500/15 text-green-400 border border-green-500/20" };
}

// The pending-dues endpoint may expose the outstanding amount under a
// different field name depending on your API — check the common variants
// first, and fall back to the member's latest plan price/payment amount if
// no explicit due amount is present in the response.
function getDueAmount(due, latestPayment) {
  if (!due) return 0;
  const raw = due.due_amount ?? due.amount_due ?? due.pending_amount ?? due.balance_due ?? due.amount;
  if (raw != null) return Number(raw) || 0;
  return Number(latestPayment?.plan?.price ?? latestPayment?.amount ?? 0) || 0;
}

// ── Status badge — same pill styling as Attendance page's StatusBadge ───────
function StatusPill({ label, dot, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// ── Payment card — always ONE card per member, built from their most recent
// payment record (see memberCards grouping in the page component below) ────
function PaymentCard({ payment, member, dueAmount, onEdit, onDelete, onViewInfo, onCollectDue, onCollectPayment }) {
  const status = membershipStatus(payment.valid_to);
  const hasDue = dueAmount > 0;

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <MemberPhoto member={member} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-100 truncate">{member.name}</p>
          <p className="text-xs text-gray-500">Member ID: {member.id}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
            <Phone size={11} className="shrink-0" /> {member.phone || "—"}
          </p>
          <div className="mt-1.5">
            <StatusPill {...status} />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEdit(payment)}
            className="text-gray-500 hover:text-brand-400 transition-colors p-1.5 rounded hover:bg-brand-500/10"
            title="Edit payment"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(payment.id)}
            className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-red-500/10"
            title="Delete payment"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Plan</p>
          <p className="text-gray-200 font-medium truncate">{payment.plan?.name || "—"}</p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Amount</p>
          <p className="text-green-400 font-mono font-semibold">₹{Number(payment.amount).toLocaleString("en-IN")}</p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Mode</p>
          <Badge type={payment.payment_mode} label={payment.payment_mode.toUpperCase()} />
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Paid On</p>
          <p className="text-gray-200 font-medium">{format(new Date(payment.paid_at), "dd MMM yyyy")}</p>
        </div>
      </div>

      <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-xs">
        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Due Amount</p>
        <p className={`font-mono font-semibold ${hasDue ? "text-red-400" : "text-green-400"}`}>
          ₹{Number(dueAmount || 0).toLocaleString("en-IN")}
        </p>
      </div>

      {/* Always visible — opens the same Collect Payment modal used elsewhere on the page */}
      <Button
        onClick={onCollectPayment}
        className="w-full justify-center text-xs py-2"
      >
        <CreditCard size={14} /> Collect Payment
      </Button>

      {hasDue ? (
        <Button
          variant="danger"
          onClick={onCollectDue}
          className="w-full justify-center text-xs py-2"
        >
          Collect Due ₹{Number(dueAmount).toLocaleString("en-IN")}
        </Button>
      ) : (
        <span className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
          Fully Paid
        </span>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400 bg-surface-muted/50 rounded-lg px-3 py-2">
        <Calendar size={13} className="text-gray-500 shrink-0" />
        <span>
          Validity:{" "}
          <span className="text-gray-200 font-medium">
            {payment.valid_from && payment.valid_to
              ? `${format(new Date(payment.valid_from), "dd MMM")} → ${format(new Date(payment.valid_to), "dd MMM yyyy")}`
              : "—"}
          </span>
        </span>
      </div>

      <Button
        variant="secondary"
        onClick={() => onViewInfo(member)}
        className="w-full justify-center text-xs py-2 mt-auto"
      >
        <Eye size={14} /> View Info
      </Button>
    </div>
  );
}

function PaymentCardSkeleton() {
  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-16 h-16 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-14" />
        </div>
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-8 w-full rounded-lg" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

// ── View Info modal ───────────────────────────────────────────────────────────
function PaymentInfoModal({ member, allPayments, dues, onClose, onEdit, onDelete }) {
  if (!member) return null;

  const history = useMemo(() => {
    return allPayments
      .filter((p) => (p.member?.id ?? p.member_id) === member.id)
      .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
  }, [allPayments, member]);

  const latest = history[0];
  const status = latest ? membershipStatus(latest.valid_to) : membershipStatus(null);
  const isOverdue = dues.some((d) => d.member_id === member.id);

  return (
    <Modal open={!!member} onClose={onClose} title="Member Payment Info" width="max-w-md">
      <div className="flex items-center gap-3 mb-5">
        <MemberPhoto member={member} size="modal" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-100 truncate">{member.name}</p>
          <p className="text-xs text-gray-500">Member ID: {member.id}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <Phone size={11} /> {member.phone || "—"}
          </p>
        </div>
        <div className="ml-auto">
          <StatusPill {...status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Shift</p>
          <p className="text-xs font-medium text-gray-200">{member.shift || "—"}</p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Plan</p>
          <p className="text-xs font-medium text-gray-200 truncate">{latest?.plan?.name || "—"}</p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Renewal Date</p>
          <p className="text-xs font-medium text-gray-200">
            {latest?.valid_to ? format(new Date(latest.valid_to), "dd MMM yyyy") : "—"}
          </p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Payment Status</p>
          <p className={`text-xs font-medium ${isOverdue ? "text-red-400" : "text-green-400"}`}>
            {isOverdue ? "Overdue" : "Up to Date"}
          </p>
        </div>
      </div>

      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Transaction History</p>
      {history.length === 0 ? (
        <EmptyState message="No payment history yet" />
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {history.map((p) => (
            <div key={p.id} className="bg-surface-muted/40 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-green-400 font-semibold text-sm">
                  ₹{Number(p.amount).toLocaleString("en-IN")}
                </span>
                <div className="flex items-center gap-2">
                  <Badge type={p.payment_mode} label={p.payment_mode.toUpperCase()} />
                  <button
                    onClick={() => onEdit(p)}
                    className="text-gray-500 hover:text-brand-400 transition-colors p-1 rounded hover:bg-brand-500/10"
                    title="Edit payment"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(p.id)}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                    title="Delete payment"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Calendar size={11} className="text-gray-500" />
                  Paid {format(new Date(p.paid_at), "dd MMM yyyy")}
                </span>
                <span>
                  {p.valid_from && p.valid_to
                    ? `${format(new Date(p.valid_from), "dd MMM")} → ${format(new Date(p.valid_to), "dd MMM yyyy")}`
                    : "—"}
                </span>
              </div>
              {p.note && <p className="text-xs text-gray-500 mt-1 italic truncate">Note: {p.note}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function PaymentList() {
  const [tab, setTab] = useState("history");
  const [payments, setPayments] = useState([]);
  const [dues, setDues] = useState([]);
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Collect modal
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [editForm, setEditForm] = useState({ amount: "", payment_mode: "cash", note: "", valid_from: "", valid_to: "" });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState(null);

  // Filter + search (search is instant/frontend-only, same style as Attendance)
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  // View Info modal
  const [infoMember, setInfoMember] = useState(null);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(false);
    return Promise.all([
      paymentsAPI.list({ limit: 200 }),
      paymentsAPI.pendingDues(),
      membersAPI.list({ limit: 200 }),
      plansAPI.list(),
    ]).then(([p, d, m, pl]) => {
      setPayments(p.data);
      setDues(d.data);
      setMembers(m.data.items || []);
      setPlans(pl.data || []);
      setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Full member records (with photo_url, shift, etc.) keyed by id, so payment
  // cards/modal can show rich member info without any new API calls — reuses
  // the same membersAPI.list() response already loaded above.
  const membersById = useMemo(() => {
    const map = new Map();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const resolveMember = useCallback(
    (payment) => membersById.get(payment.member?.id ?? payment.member_id) || payment.member || {},
    [membersById]
  );

  const set = (k) => (e) => {
    const updated = { ...form, [k]: e.target.value };
    if (k === "plan_id" && e.target.value) {
      const plan = plans.find((p) => p.id === parseInt(e.target.value));
      if (plan) {
        const from = updated.valid_from || format(new Date(), "yyyy-MM-dd");
        updated.amount = plan.price;
        // duration_months -> duration_days via the shared plan mapping,
        // then valid_to = valid_from + duration_days (not month arithmetic).
        updated.valid_to = calcRenewalDate(from, plan.duration_months);
      }
    }
    setForm(updated);
  };

  const setEdit = (k) => (e) => setEditForm({ ...editForm, [k]: e.target.value });

  const openCollect = (memberId = "") => {
    setForm({ ...EMPTY_FORM, member_id: memberId, valid_from: format(new Date(), "yyyy-MM-dd") });
    setModal(true);
  };

  const openEdit = (p) => {
    setEditPayment(p);
    setEditForm({
      amount: p.amount,
      payment_mode: p.payment_mode,
      note: p.note || "",
      valid_from: p.valid_from ? format(new Date(p.valid_from), "yyyy-MM-dd") : "",
      valid_to: p.valid_to ? format(new Date(p.valid_to), "yyyy-MM-dd") : "",
    });
    setEditModal(true);
  };

  const collect = async (e) => {
    e.preventDefault();
    if (!form.member_id) { toast.error("Select a member"); return; }
    setSaving(true);
    try {
      const payload = { ...form, member_id: parseInt(form.member_id), amount: parseFloat(form.amount) };
      if (form.plan_id) payload.plan_id = parseInt(form.plan_id);
      else delete payload.plan_id;
      if (!payload.valid_from) delete payload.valid_from;
      if (!payload.valid_to) delete payload.valid_to;
      await paymentsAPI.collect(payload);
      toast.success("Payment collected!");
      setModal(false);
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error");
    } finally { setSaving(false); }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setEditSaving(true);
    try {
      const payload = {
        amount: parseFloat(editForm.amount),
        payment_mode: editForm.payment_mode,
        note: editForm.note,
      };
      if (editForm.valid_from) payload.valid_from = editForm.valid_from;
      if (editForm.valid_to) payload.valid_to = editForm.valid_to;
      await paymentsAPI.update(editPayment.id, payload);
      toast.success("Payment updated!");
      setEditModal(false);
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Update failed");
    } finally { setEditSaving(false); }
  };

  const confirmDelete = async () => {
    try {
      await paymentsAPI.delete(deleteId);
      toast.success("Payment deleted");
      setDeleteId(null);
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Delete failed");
    }
  };

  // ── Export Payments ────────────────────────────────────────────────────────
  const exportPayments = () => {
    const toastId = toast.loading("Exporting payments…");
    try {
      const rows = filteredPayments.map((p) => ({
        Member: p.member?.name || "",
        Phone: p.member?.phone || "",
        "Amount (₹)": Number(p.amount),
        "Payment Mode": p.payment_mode?.toUpperCase() || "",
        "Valid From": p.valid_from ? format(new Date(p.valid_from), "dd MMM yyyy") : "",
        "Valid To": p.valid_to ? format(new Date(p.valid_to), "dd MMM yyyy") : "",
        "Paid On": p.paid_at ? format(new Date(p.paid_at), "dd MMM yyyy") : "",
        Note: p.note || "",
      }));
      exportToExcel(rows, "Payments");
      toast.success("Payments exported!", { id: toastId });
    } catch {
      toast.error("Export failed", { id: toastId });
    }
  };

  // Filter logic (unchanged from original)
  const now = new Date();
  const filteredPayments = payments.filter((p) => {
    if (filter === "all") return true;
    if (filter === "this_month") {
      const paid = new Date(p.paid_at);
      return paid >= startOfMonth(now) && paid <= endOfMonth(now);
    }
    if (filter === "expired") {
      return p.valid_to && isBefore(new Date(p.valid_to), now);
    }
    if (filter === "pending") {
      return !p.valid_to || isAfter(new Date(p.valid_to), now);
    }
    return true;
  });

  // ── Group payments by member — ONE card per member, always ─────────────────
  // This is what fixes the duplicate-card bug: instead of rendering a card
  // per payment row (which meant collecting a new due payment added a
  // second card for the same member), we group all payments by member id and
  // keep only their single most recent payment for the card. Whether a
  // member has one payment or ten, they appear exactly once.
  const duesByMember = useMemo(() => {
    const map = new Map();
    for (const d of dues) map.set(d.member_id, d);
    return map;
  }, [dues]);

  const memberCards = useMemo(() => {
    const map = new Map();
    for (const p of filteredPayments) {
      const id = p.member?.id ?? p.member_id;
      if (id == null) continue;
      const existing = map.get(id);
      if (!existing || new Date(p.paid_at) > new Date(existing.paid_at)) {
        map.set(id, p);
      }
    }
    return Array.from(map.entries())
      .map(([memberId, latest]) => ({ memberId, latest }))
      .sort((a, b) => new Date(b.latest.paid_at) - new Date(a.latest.paid_at));
  }, [filteredPayments]);

  // Instant frontend search — Name, Phone, or Member ID (same behavior as
  // Attendance page's search bar).
  const searchedMemberCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memberCards;
    return memberCards.filter(({ latest }) => {
      const member = resolveMember(latest);
      return (
        member.name?.toLowerCase().includes(q)
        || member.phone?.toLowerCase().includes(q)
        || String(member.id ?? "").toLowerCase().includes(q)
      );
    });
  }, [memberCards, search, resolveMember]);

  const memberOpts = [{ value: "", label: "Select member" }, ...members.map((m) => ({ value: m.id, label: `${m.name} — ${m.phone}` }))];
  const planOpts = [{ value: "", label: "Select plan" }, ...plans.map((p) => ({ value: p.id, label: `${p.name} — ₹${Number(p.price).toLocaleString("en-IN")}` }))];

  return (
    <AppLayout title="Payments">
      <div className="flex gap-4 mb-5 items-center justify-between flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {[["history", "Payment History"], ["dues", `Pending Dues${dues.length > 0 ? ` (${dues.length})` : ""}`]].map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${tab === t ? "bg-brand-500 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-surface-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <Button onClick={() => openCollect()}><Plus size={15} /> Collect Payment</Button>
        </div>
      </div>

      {tab === "history" ? (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search by member name, phone, or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {FILTER_OPTS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  filter === f.value
                    ? "bg-brand-500/20 text-brand-400 border-brand-500/40"
                    : "text-gray-400 border-surface-border hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <PaymentCardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="card">
              <ErrorState message="Couldn't load payment data" onRetry={loadData} />
            </div>
          ) : searchedMemberCards.length === 0 ? (
            <div className="card">
              <EmptyState message={payments.length === 0 ? "No payments found" : "No payments match your search"} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {searchedMemberCards.map(({ memberId, latest }) => (
                <PaymentCard
                  key={memberId}
                  payment={latest}
                  member={resolveMember(latest)}
                  dueAmount={getDueAmount(duesByMember.get(memberId), latest)}
                  onEdit={openEdit}
                  onDelete={setDeleteId}
                  onViewInfo={setInfoMember}
                  onCollectDue={() => openCollect(memberId)}
                  onCollectPayment={() => openCollect(memberId)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card p-0 overflow-hidden">
          {dues.length === 0 ? <EmptyState message="No pending dues" /> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted/40">
                  <tr>
                    <th className="table-th">Name</th>
                    <th className="table-th hidden sm:table-cell">Phone</th>
                    <th className="table-th">Expiry Date</th>
                    <th className="table-th">Days Overdue</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {dues.map((d) => {
                    const overdueDays = d.days_overdue || getOverdueDays(d.renewal_date);
                    return (
                      <tr key={d.member_id} className="table-row">
                        <td className="table-td">
                          <p className="font-medium text-gray-100">{d.name}</p>
                          <p className="text-xs text-gray-500 sm:hidden">{d.phone}</p>
                        </td>
                        <td className="table-td hidden sm:table-cell text-gray-400">{d.phone}</td>
                        <td className="table-td text-yellow-400 text-sm">
                          {d.renewal_date ? format(new Date(d.renewal_date), "dd MMM yyyy") : "—"}
                        </td>
                        <td className="table-td">
                          {overdueDays > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-md text-xs font-semibold">
                              <AlertCircle size={11} /> {overdueDays}d overdue
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">—</span>
                          )}
                        </td>
                        <td className="table-td text-right">
                          <Button onClick={() => openCollect(d.member_id)} className="text-xs px-3 py-1.5 h-auto">
                            Collect
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Collect Payment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Collect Payment">
        <form onSubmit={collect} className="space-y-4">
          <FormField label="Member *">
            <Select options={memberOpts} value={form.member_id} onChange={set("member_id")} />
          </FormField>
          <FormField label="Plan (auto-fills amount)">
            <Select options={planOpts} value={form.plan_id} onChange={set("plan_id")} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Amount (₹) *">
              <input type="number" required className="input" value={form.amount} onChange={set("amount")} placeholder="0" min="1" />
            </FormField>
            <FormField label="Payment mode">
              <Select options={MODE_OPTS} value={form.payment_mode} onChange={set("payment_mode")} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Valid from">
              <input type="date" className="input" value={form.valid_from} onChange={set("valid_from")} />
            </FormField>
            <FormField label="Valid to">
              <input type="date" className="input" value={form.valid_to} onChange={set("valid_to")} />
            </FormField>
          </div>
          <FormField label="Note">
            <input type="text" className="input" value={form.note} onChange={set("note")} placeholder="Optional" />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Collect</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Payment">
        <form onSubmit={saveEdit} className="space-y-4">
          {editPayment && (
            <div className="bg-surface-muted/40 rounded-lg px-4 py-3 text-sm text-gray-300 border border-surface-border">
              <span className="font-medium text-gray-100">{editPayment.member?.name}</span>
              <span className="text-gray-500 text-xs ml-2">{editPayment.member?.phone}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Amount (₹) *">
              <input type="number" required className="input" value={editForm.amount} onChange={setEdit("amount")} min="1" />
            </FormField>
            <FormField label="Payment mode">
              <Select options={MODE_OPTS} value={editForm.payment_mode} onChange={setEdit("payment_mode")} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Valid from">
              <input type="date" className="input" value={editForm.valid_from} onChange={setEdit("valid_from")} />
            </FormField>
            <FormField label="Valid to">
              <input type="date" className="input" value={editForm.valid_to} onChange={setEdit("valid_to")} />
            </FormField>
          </div>
          <FormField label="Note">
            <input type="text" className="input" value={editForm.note} onChange={setEdit("note")} placeholder="Optional" />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditModal(false)}>Cancel</Button>
            <Button type="submit" loading={editSaving}>Save changes</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        message="Delete this payment record? This cannot be undone."
      />

      {/* View Info modal — full profile + complete transaction history */}
      <PaymentInfoModal
        member={infoMember}
        allPayments={payments}
        dues={dues}
        onClose={() => setInfoMember(null)}
        onEdit={(p) => { setInfoMember(null); openEdit(p); }}
        onDelete={(id) => { setInfoMember(null); setDeleteId(id); }}
      />

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={[
          { label: "Collect Payment",  icon: CreditCard,      onClick: () => openCollect() },
          { label: "Edit Payment",     icon: Edit2,           onClick: () => {
              if (payments.length > 0) openEdit(payments[0]);
              else toast.error("No payments to edit");
          }},
          { label: "Export Payments",  icon: FileSpreadsheet, onClick: exportPayments },
        ]}
      />
    </AppLayout>
  );
}

import { useEffect, useState } from "react";
import { Plus, AlertCircle, Edit2, Trash2, CreditCard, FileSpreadsheet } from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button, Modal, Badge, FormField, Select, Spinner, EmptyState, ConfirmDialog } from "../../components/ui/index";
import { paymentsAPI, membersAPI, plansAPI } from "../../api/client";
import { format, addMonths, isSameMonth, isAfter, isBefore, startOfMonth, endOfMonth, differenceInDays } from "date-fns";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";
import { exportToExcel } from "../../utils/exportExcel";

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

export default function PaymentList() {
  const [tab, setTab] = useState("history");
  const [payments, setPayments] = useState([]);
  const [dues, setDues] = useState([]);
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Filter
  const [filter, setFilter] = useState("all");

  // FAB
  const [fabOpen, setFabOpen] = useState(false);

  const loadData = () => {
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
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const set = (k) => (e) => {
    const updated = { ...form, [k]: e.target.value };
    if (k === "plan_id" && e.target.value) {
      const plan = plans.find((p) => p.id === parseInt(e.target.value));
      if (plan) {
        const from = new Date(updated.valid_from || new Date());
        updated.amount = plan.price;
        updated.valid_to = format(addMonths(from, plan.duration_months), "yyyy-MM-dd");
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

  // Filter logic
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
        <Button onClick={() => openCollect()}><Plus size={15} /> Collect Payment</Button>
      </div>

      {loading ? <Spinner /> : tab === "history" ? (
        <>
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

          <div className="card p-0 overflow-hidden">
            {filteredPayments.length === 0 ? <EmptyState message="No payments found" /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-muted/40">
                    <tr>
                      <th className="table-th">Member</th>
                      <th className="table-th hidden sm:table-cell">Amount</th>
                      <th className="table-th hidden md:table-cell">Mode</th>
                      <th className="table-th hidden md:table-cell">Validity</th>
                      <th className="table-th">Date</th>
                      <th className="table-th text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((p) => (
                      <tr key={p.id} className="table-row">
                        <td className="table-td">
                          <p className="font-medium text-gray-100">{p.member?.name}</p>
                          <p className="text-xs text-gray-500">{p.member?.phone}</p>
                        </td>
                        <td className="table-td hidden sm:table-cell font-mono text-green-400 font-semibold">
                          ₹{Number(p.amount).toLocaleString("en-IN")}
                        </td>
                        <td className="table-td hidden md:table-cell">
                          <Badge type={p.payment_mode} label={p.payment_mode.toUpperCase()} />
                        </td>
                        <td className="table-td hidden md:table-cell text-xs text-gray-400">
                          {p.valid_from && p.valid_to
                            ? `${format(new Date(p.valid_from), "dd MMM")} → ${format(new Date(p.valid_to), "dd MMM yyyy")}`
                            : "—"}
                        </td>
                        <td className="table-td text-xs text-gray-400">{format(new Date(p.paid_at), "dd MMM yyyy")}</td>
                        <td className="table-td text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openEdit(p)}
                              className="text-gray-500 hover:text-brand-400 transition-colors p-1 rounded hover:bg-brand-500/10"
                              title="Edit payment"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteId(p.id)}
                              className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                              title="Delete payment"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                    const overdueDays = d.days_overdue || (
                      d.renewal_date
                        ? Math.max(0, differenceInDays(now, new Date(d.renewal_date)))
                        : 0
                    );
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

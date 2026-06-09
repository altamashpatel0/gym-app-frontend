import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button, Modal, FormField, ConfirmDialog, EmptyState, Spinner } from "../../components/ui/index";
import { plansAPI } from "../../api/client";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";

const EMPTY = { name: "", duration_months: 1, price: "", description: "" };
const DURATION_OPTS = [
  { value: 1, label: "Monthly (1 month)" },
  { value: 3, label: "Quarterly (3 months)" },
  { value: 6, label: "Half-yearly (6 months)" },
  { value: 12, label: "Yearly (12 months)" },
];

export default function PlanList() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);

  const load = () => plansAPI.list().then(({ data }) => { setPlans(data); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name, duration_months: p.duration_months, price: p.price, description: p.description || "" });
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await plansAPI.update(editing.id, form);
        toast.success("Plan updated");
      } else {
        await plansAPI.create(form);
        toast.success("Plan created");
      }
      setModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error");
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async () => {
    try {
      await plansAPI.delete(deleteId);
      toast.success("Plan deactivated");
      setDeleteId(null);
      load();
    } catch {
      toast.error("Error deactivating plan");
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Edit Plan via FAB: opens edit modal for first plan (user can pick from table otherwise)
  const openEditFirst = () => {
    if (plans.length > 0) openEdit(plans[0]);
    else toast.error("No plans to edit yet");
  };

  const fabActions = [
    { label: "Add Plan",  icon: Plus,  onClick: openAdd },
    { label: "Edit Plan", icon: Edit2, onClick: openEditFirst },
  ];

  return (
    <AppLayout title="Membership Plans">
      <div className="flex justify-end mb-5">
        <Button onClick={openAdd}><Plus size={15} /> Add Plan</Button>
      </div>

      {loading ? <Spinner /> : plans.length === 0 ? <EmptyState message="No plans yet" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="card relative">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-semibold text-white">{p.name}</h3>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(p)} className="text-gray-500 hover:text-brand-400"><Edit2 size={13} /></button>
                  <button onClick={() => setDeleteId(p.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>
              <p className="text-2xl font-bold text-brand-400 mb-1">₹{Number(p.price).toLocaleString("en-IN")}</p>
              <p className="text-xs text-gray-500">
                {DURATION_OPTS.find((d) => d.value === p.duration_months)?.label || `${p.duration_months} months`}
              </p>
              {p.description && <p className="text-xs text-gray-400 mt-2">{p.description}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Edit Plan" : "New Plan"}>
        <form onSubmit={save} className="space-y-4">
          <FormField label="Plan name *">
            <input type="text" required className="input" value={form.name} onChange={set("name")} placeholder="e.g. Gold Monthly" />
          </FormField>
          <FormField label="Duration">
            <select className="input" value={form.duration_months} onChange={set("duration_months")} style={{ WebkitAppearance: "none" }}>
              {DURATION_OPTS.map((o) => <option key={o.value} value={o.value} className="bg-surface-card">{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Price (₹) *">
            <input type="number" required min="0" className="input" value={form.price} onChange={set("price")} placeholder="999" />
          </FormField>
          <FormField label="Description">
            <input type="text" className="input" value={form.description} onChange={set("description")} placeholder="Optional note" />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save" : "Create"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={deletePlan} message="Deactivate this plan?" />

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={fabActions}
      />
    </AppLayout>
  );
}

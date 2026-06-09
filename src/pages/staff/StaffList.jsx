import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  Button, Badge, Modal, Spinner, EmptyState,
  FormField, Select, ConfirmDialog
} from "../../components/ui/index";
import { staffAPI } from "../../api/client";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";

const ROLE_OPTS = [
  { value: "admin",   label: "Admin"   },
  { value: "staff",   label: "Staff"   },
  { value: "trainer", label: "Trainer" },
];

const EMPTY_FORM = { name: "", phone: "", email: "", role: "staff", password: "" };

export default function StaffList() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await staffAPI.list();
      setStaff(Array.isArray(data) ? data : data.items || []);
    } catch {
      toast.error("Failed to load staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, phone: s.phone, email: s.email || "", role: s.role, password: "" });
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (editing) {
        await staffAPI.update(editing.id, payload);
        toast.success("Staff updated");
      } else {
        await staffAPI.create(payload);
        toast.success("Staff member added");
      }
      setModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error saving");
    } finally {
      setSaving(false);
    }
  };

  const deleteStaff = async () => {
    try {
      await staffAPI.delete(deleteId);
      toast.success("Staff member removed");
      setDeleteId(null);
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openEditFirst = () => {
    if (staff.length > 0) openEdit(staff[0]);
    else toast.error("No staff to edit yet");
  };

  const fabActions = [
    { label: "Add Staff",  icon: Plus,  onClick: openAdd },
    { label: "Edit Staff", icon: Edit2, onClick: openEditFirst },
  ];

  return (
    <AppLayout title="Staff">
      <div className="flex justify-end mb-5">
        <Button onClick={openAdd}><Plus size={15} /> Add Staff</Button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : staff.length === 0 ? (
          <EmptyState message="No staff members yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-muted/40">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th hidden sm:table-cell">Phone</th>
                  <th className="table-th hidden md:table-cell">Email</th>
                  <th className="table-th">Role</th>
                  <th className="table-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="table-row">
                    <td className="table-td">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-400 shrink-0">
                          {s.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-100">{s.name}</p>
                          <p className="text-xs text-gray-500 sm:hidden">{s.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td hidden sm:table-cell text-gray-400">{s.phone}</td>
                    <td className="table-td hidden md:table-cell text-gray-400 text-xs">{s.email || "—"}</td>
                    <td className="table-td"><Badge type={s.role} label={s.role} /></td>
                    <td className="table-td text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openEdit(s)} className="text-gray-500 hover:text-brand-400 transition-colors">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setDeleteId(s.id)} className="text-gray-500 hover:text-red-400 transition-colors">
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

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Edit Staff" : "Add Staff"} width="max-w-md">
        <form onSubmit={save} className="space-y-4">
          <FormField label="Full name *">
            <input type="text" required className="input" value={form.name} onChange={set("name")} />
          </FormField>
          <FormField label="Phone *">
            <input type="tel" required className="input" value={form.phone} onChange={set("phone")} />
          </FormField>
          <FormField label="Email">
            <input type="email" className="input" value={form.email} onChange={set("email")} />
          </FormField>
          <FormField label="Role">
            <Select options={ROLE_OPTS} value={form.role} onChange={set("role")} />
          </FormField>
          <FormField label={editing ? "New password (leave blank to keep)" : "Password *"}>
            <input
              type="password"
              required={!editing}
              className="input"
              value={form.password}
              onChange={set("password")}
              autoComplete="new-password"
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save changes" : "Add staff"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={deleteStaff}
        message="Remove this staff member? They will lose access to the system."
      />

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={fabActions}
      />
    </AppLayout>
  );
}

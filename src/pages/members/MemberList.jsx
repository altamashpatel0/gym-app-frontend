import { useEffect, useRef, useState } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Plus, Edit2, Trash2, Camera as CameraIcon, Upload, FolderOpen, FileText, Loader2, X, ExternalLink, Eye, UserPlus, FileSpreadsheet } from "lucide-react";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  Button, Badge, Modal, SearchBar, Pagination,
  ConfirmDialog, FormField, Select, EmptyState, Spinner
} from "../../components/ui/index";
import { membersAPI, plansAPI, mediaAPI } from "../../api/client";
import { format, differenceInDays, addMonths } from "date-fns";
import useAuthStore from "../../store/authStore";
import { exportToExcel } from "../../utils/exportExcel";

// ── Renewal date auto-calculation ──────────────────────────────────────────────
function getPlanMonths(planName) {
  if (!planName) return null;
  const match = planName.match(/(\d+)\s*month/i);
  return match ? parseInt(match[1]) : null;
}

function calcRenewalDate(joinDate, planName) {
  if (!joinDate || !planName) return "";
  const months = getPlanMonths(planName);
  if (!months) return "";
  const result = addMonths(new Date(joinDate), months);
  return format(result, "yyyy-MM-dd");
}

// ── Renewal countdown label + color ───────────────────────────────────────────
function getRenewalInfo(renewalDate) {
  if (!renewalDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewal = new Date(renewalDate);
  renewal.setHours(0, 0, 0, 0);
  const days = differenceInDays(renewal, today);

  let label;
  if (days > 1)        label = `${days} days left`;
  else if (days === 1) label = "Tomorrow";
  else if (days === 0) label = "Today expires";
  else                 label = `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`;

  let cls;
  if (days > 15)      cls = "text-green-400";
  else if (days >= 7) cls = "text-yellow-400";
  else if (days >= 0) cls = "text-orange-400";
  else                cls = "text-red-400";

  return { label, cls };
}

const STATUS_OPTS = [
  { value: "", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "paused", label: "Paused" },
];

const GENDER_OPTS = [
  { value: "", label: "Select gender" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const DOC_TYPE_OPTS = [
  { value: "", label: "Select type" },
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN Card" },
  { value: "agreement", label: "Agreement / Contract" },
  { value: "medical", label: "Medical" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM = {
  name: "", phone: "", email: "", address: "", dob: "",
  gender: "", plan_id: "", join_date: "", renewal_date: "",
  status: "active", assigned_trainer_id: "",
};

const EMPTY_DOC_META = { document_name: "", document_type: "" };

function getMemberStatus(member) {
  if (member.status === "expired") return "expired";
  if (member.status === "active" && member.renewal_date) {
    const days = differenceInDays(new Date(member.renewal_date), new Date());
    if (days < 0) return "expired";
    if (days <= 7) return "expiring_soon";
  }
  return member.status || "active";
}

const STATUS_BADGE = {
  active: { cls: "bg-green-500/15 text-green-400 border border-green-500/20", label: "Active" },
  expiring_soon: { cls: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20", label: "Expiring Soon" },
  expired: { cls: "bg-red-500/15 text-red-400 border border-red-500/20", label: "Expired" },
  paused: { cls: "bg-gray-500/15 text-gray-300 border border-gray-500/20", label: "Paused" },
};

function MemberStatusBadge({ member }) {
  const status = getMemberStatus(member);
  const cfg = STATUS_BADGE[status] || STATUS_BADGE.active;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function MemberAvatar({ member, size = 8, onClick }) {
  const [imgError, setImgError] = useState(false);
  const initials = member.name
    ? member.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  if (member.photo_url && !imgError) {
    return (
      <img
        src={member.photo_url}
        alt={member.name}
        onClick={onClick}
        className={`w-${size} h-${size} rounded-full object-cover shrink-0 border border-surface-border cursor-pointer transition-transform duration-150 hover:scale-110`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className={`w-${size} h-${size} rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0`}
    >
      <span className="text-xs font-bold text-brand-400">{initials}</span>
    </div>
  );
}

// ── Document Meta Modal ────────────────────────────────────────────────────────
function DocMetaModal({ open, onClose, onConfirm, uploading }) {
  const [meta, setMeta] = useState(EMPTY_DOC_META);
  const setField = (k) => (e) => setMeta((prev) => ({ ...prev, [k]: e.target.value }));

  useEffect(() => {
    if (open) setMeta(EMPTY_DOC_META);
  }, [open]);

  const handleConfirm = () => {
    if (!meta.document_name.trim()) {
      toast.error("Please enter a document name");
      return;
    }
    if (!meta.document_type) {
      toast.error("Please select a document type");
      return;
    }
    onConfirm(meta);
  };

  return (
    <Modal open={open} onClose={onClose} title="Document Details" width="max-w-sm">
      <div className="space-y-4">
        <FormField label="Document Name *">
          <input
            type="text"
            className="input"
            placeholder="e.g. Aadhaar Card"
            value={meta.document_name}
            onChange={setField("document_name")}
          />
        </FormField>
        <FormField label="Document Type *">
          <Select
            options={DOC_TYPE_OPTS}
            value={meta.document_type}
            onChange={setField("document_type")}
          />
        </FormField>
        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={uploading} onClick={handleConfirm}>
            Upload
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Documents Modal ────────────────────────────────────────────────────────────
function DocumentsModal({ member, open, onClose }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const [pendingFile, setPendingFile] = useState(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const docInputRef = useRef();

  const loadDocs = async () => {
    if (!member) return;
    setLoading(true);
    try {
      const { data } = await mediaAPI.getDocuments(member.id);
      setDocs(Array.isArray(data) ? data : data.items || []);
    } catch {
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadDocs();
  }, [open, member]);

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setMetaOpen(true);
    e.target.value = "";
  };

  const handleMetaConfirm = async ({ document_name, document_type }) => {
    if (!pendingFile || !member) return;
    setUploading(true);
    const toastId = toast.loading("Uploading document…");
    try {
      await mediaAPI.uploadDocument(member.id, pendingFile, document_name, document_type);
      toast.success("Document uploaded", { id: toastId });
      setMetaOpen(false);
      setPendingFile(null);
      loadDocs();
    } catch {
      toast.error("Upload failed", { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const handleMetaClose = () => {
    setMetaOpen(false);
    setPendingFile(null);
  };

  const handleDelete = async (docId) => {
    setDeleting(docId);
    try {
      await mediaAPI.deleteDocument(docId);
      toast.success("Deleted");
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const isImage = (doc) => {
    const url = doc.file_url || doc.url || "";
    const name = doc.name || doc.file_name || "";
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url) || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  };

  const getDocUrl = (doc) => doc.file_url || doc.url || "#";
  const getDocName = (doc) => doc.name || doc.file_name || doc.original_name || "Document";
  const getDocDate = (doc) => {
    const d = doc.created_at || doc.uploaded_at;
    return d ? format(new Date(d), "dd MMM yyyy") : "—";
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Documents — ${member?.name || ""}`} width="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">{docs.length} document{docs.length !== 1 ? "s" : ""}</p>
            <Button
              onClick={() => docInputRef.current?.click()}
              className="text-xs px-3 py-1.5"
            >
              <Upload size={12} /> Upload New
            </Button>
            <input ref={docInputRef} type="file" className="hidden" onChange={handleFileSelected} />
          </div>

          {loading ? (
            <Spinner />
          ) : docs.length === 0 ? (
            <div className="py-10 text-center">
              <FolderOpen size={32} className="mx-auto text-gray-600 mb-2" />
              <p className="text-sm text-gray-500">No documents yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 bg-surface-muted border border-surface-border rounded-lg p-3"
                >
                  {isImage(doc) ? (
                    <img
                      src={getDocUrl(doc)}
                      alt={getDocName(doc)}
                      className="w-12 h-12 object-cover rounded-md border border-surface-border shrink-0"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <FileText size={20} className="text-red-400" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate font-medium">{getDocName(doc)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{getDocDate(doc)}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={getDocUrl(doc)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                      title="Open"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deleting === doc.id}
                      className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {deleting === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <DocMetaModal
        open={metaOpen}
        onClose={handleMetaClose}
        onConfirm={handleMetaConfirm}
        uploading={uploading}
      />
    </>
  );
}

// ── Member View Modal ──────────────────────────────────────────────────────────
function MemberViewModal({ member, open, onClose }) {
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [imgError, setImgError] = useState(false);

  const initials = member?.name
    ? member.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const isImage = (doc) => {
    const url = doc.file_url || doc.url || "";
    const name = doc.name || doc.file_name || "";
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url) || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  };
  const getDocUrl = (doc) => doc.file_url || doc.url || "#";
  const getDocName = (doc) => doc.name || doc.file_name || doc.original_name || "Document";

  useEffect(() => {
    if (!open || !member) return;
    setImgError(false);
    setLoadingDocs(true);
    mediaAPI.getDocuments(member.id)
      .then(({ data }) => setDocs(Array.isArray(data) ? data : data.items || []))
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [open, member]);

  if (!member) return null;

  const status = getMemberStatus(member);
  const statusCfg = STATUS_BADGE[status] || STATUS_BADGE.active;

  const Row = ({ label, value }) =>
    value ? (
      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3">
        <span className="text-xs text-gray-500 sm:w-32 shrink-0">{label}</span>
        <span className="text-sm text-gray-200 break-all">{value}</span>
      </div>
    ) : null;

  return (
    <Modal open={open} onClose={onClose} title="Member Details" width="max-w-lg">
      <div className="space-y-5">
        {/* Photo + name header */}
        <div className="flex items-center gap-4">
          {member.photo_url && !imgError ? (
            <img
              src={member.photo_url}
              alt={member.name}
              className="w-20 h-20 rounded-full object-cover border-2 border-brand-500/40 shrink-0"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand-500/20 border-2 border-brand-500/30 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-brand-400">{initials}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-lg font-semibold text-gray-100 truncate">{member.name}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium mt-1 ${statusCfg.cls}`}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        {/* Details grid */}
        <div className="bg-surface-muted border border-surface-border rounded-lg p-4 space-y-3">
          <Row label="Phone" value={member.phone} />
          <Row label="Email" value={member.email} />
          <Row label="Age" value={member.age} />
          <Row label="Gender" value={member.gender ? member.gender.charAt(0).toUpperCase() + member.gender.slice(1) : null} />
          <Row label="Plan" value={member.plan?.name} />
          <Row label="Status" value={statusCfg.label} />
          <Row label="Join Date" value={member.join_date ? format(new Date(member.join_date), "dd MMM yyyy") : null} />
          <Row label="Renewal Date" value={member.renewal_date ? format(new Date(member.renewal_date), "dd MMM yyyy") : null} />
          <Row label="Address" value={member.address} />
        </div>

        {/* Documents */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Uploaded Documents</p>
          {loadingDocs ? (
            <Spinner />
          ) : docs.length === 0 ? (
            <div className="py-6 text-center bg-surface-muted border border-surface-border rounded-lg">
              <FolderOpen size={24} className="mx-auto text-gray-600 mb-1" />
              <p className="text-xs text-gray-500">No documents uploaded</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {docs.map((doc) => (
                <a
                  key={doc.id}
                  href={getDocUrl(doc)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-surface-muted border border-surface-border rounded-lg p-3 hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors group"
                >
                  {isImage(doc) ? (
                    <img
                      src={getDocUrl(doc)}
                      alt={getDocName(doc)}
                      className="w-10 h-10 object-cover rounded-md border border-surface-border shrink-0"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-red-400" />
                    </div>
                  )}
                  <p className="text-sm text-gray-300 truncate flex-1 group-hover:text-brand-400 transition-colors">
                    {getDocName(doc)}
                  </p>
                  <ExternalLink size={13} className="text-gray-600 group-hover:text-brand-400 transition-colors shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MemberList() {
  const { user } = useAuthStore();
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [serialOffset, setSerialOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  // Media state
  const [photoUploading, setPhotoUploading] = useState(null);
  const [docsModal, setDocsModal] = useState(null);

  // Row-level doc upload state
  const docRowInputRef = useRef();
  const docRowTargetRef = useRef(null);
  const [rowDocPendingFile, setRowDocPendingFile] = useState(null);
  const [rowDocMetaOpen, setRowDocMetaOpen] = useState(false);
  const [rowDocUploading, setRowDocUploading] = useState(false);

  // Photo preview modal
  const [previewImage, setPreviewImage] = useState(null);

  // View member modal
  const [viewModal, setViewModal] = useState(null);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e) => { if (e.key === "Escape") setPreviewImage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewImage]);

  const canDelete = ["owner", "admin"].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await membersAPI.list({ search, status: statusFilter, page, limit: 20 });
      setMembers(data.items);
      setTotal(data.total);
      setSerialOffset((page - 1) * 20);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    plansAPI.list().then(({ data }) => setPlans(data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [search, statusFilter, page]);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({
      name: m.name, phone: m.phone, email: m.email || "",
      address: m.address || "", dob: m.dob || "", gender: m.gender || "",
      plan_id: m.plan_id || "", join_date: m.join_date || "",
      renewal_date: m.renewal_date || "", status: m.status,
      assigned_trainer_id: m.assigned_trainer_id || "",
    });
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.plan_id) delete payload.plan_id;
      else payload.plan_id = parseInt(payload.plan_id);
      if (!payload.assigned_trainer_id) delete payload.assigned_trainer_id;
      if (!payload.dob) delete payload.dob;
      if (!payload.join_date) delete payload.join_date;
      if (!payload.renewal_date) delete payload.renewal_date;

      if (editing) {
        await membersAPI.update(editing.id, payload);
        toast.success("Member updated");
        setModal(false);
        load();
      } else {
        await membersAPI.create(payload);
        toast.success("Member added");
        setModal(false);
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error saving");
    } finally {
      setSaving(false);
    }
  };

  const deleteMember = async () => {
    try {
      await membersAPI.delete(deleteId);
      toast.success("Deleted");
      setDeleteId(null);
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  // ── Camera / Photo upload (Capacitor) ─────────────────────────────────────
  const takePhoto = async (member) => {
    const memberId = member.id;
    setPhotoUploading(memberId);

    try {
      const permissions = await Camera.requestPermissions({
        permissions: ["camera", "photos"]
      });

      console.log("Permissions:", permissions);

      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
      });

      const response = await fetch(image.webPath);
      const blob = await response.blob();

      const file = new File(
        [blob],
        `photo_${memberId}.jpg`,
        { type: blob.type || "image/jpeg" }
      );

      await mediaAPI.uploadPhoto(memberId, file);

      toast.success("Photo updated!");
      load();

    } catch (err) {
      console.error("Camera error:", err);
      toast.error(err?.message || "Camera failed");
    } finally {
      setPhotoUploading(null);
    }
  };

  // ── Doc upload (from row button) — Step 1: pick file ─────────────────────
  const triggerDocUpload = (member) => {
    docRowTargetRef.current = member.id;
    docRowInputRef.current?.click();
  };

  const handleDocRowFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRowDocPendingFile(file);
    setRowDocMetaOpen(true);
    e.target.value = "";
  };

  // ── Doc upload (from row button) — Step 2: meta confirmed → upload ────────
  const handleRowDocMetaConfirm = async ({ document_name, document_type }) => {
    const memberId = docRowTargetRef.current;
    if (!rowDocPendingFile || !memberId) return;
    setRowDocUploading(true);
    const toastId = toast.loading("Uploading document…");
    try {
      await mediaAPI.uploadDocument(memberId, rowDocPendingFile, document_name, document_type);
      toast.success("Document uploaded!", { id: toastId });
      setRowDocMetaOpen(false);
      setRowDocPendingFile(null);
    } catch {
      toast.error("Upload failed", { id: toastId });
    } finally {
      setRowDocUploading(false);
    }
  };

  const handleRowDocMetaClose = () => {
    setRowDocMetaOpen(false);
    setRowDocPendingFile(null);
  };

  // ── Export Members ─────────────────────────────────────────────────────────
  const exportMembers = async () => {
    const toastId = toast.loading("Exporting members…");
    try {
      const { data } = await membersAPI.list({ search, status: statusFilter, limit: 10000 });
      const rows = (data.items || []).map((m) => ({
        Name: m.name,
        Phone: m.phone,
        Email: m.email || "",
        Gender: m.gender || "",
        Age: m.age || "",
        Plan: m.plan?.name || "",
        Status: getMemberStatus(m),
        "Join Date": m.join_date ? format(new Date(m.join_date), "dd MMM yyyy") : "",
        "Renewal Date": m.renewal_date ? format(new Date(m.renewal_date), "dd MMM yyyy") : "",
        Address: m.address || "",
      }));
      exportToExcel(rows, "Members");
      toast.success("Members exported!", { id: toastId });
    } catch {
      toast.error("Export failed", { id: toastId });
    }
  };

  const planOpts = [{ value: "", label: "No plan" }, ...plans.map((p) => ({ value: p.id, label: p.name }))];
  const set = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  // Auto-recalculate renewal when join_date changes
  const handleJoinDateChange = (e) => {
    const joinDate = e.target.value;
    const planName = plans.find((p) => String(p.id) === String(form.plan_id))?.name || "";
    const renewal = calcRenewalDate(joinDate, planName);
    setForm((prev) => ({ ...prev, join_date: joinDate, renewal_date: renewal }));
  };

  // Auto-recalculate renewal when plan changes
  const handlePlanChange = (e) => {
    const planId = e.target.value;
    const planName = plans.find((p) => String(p.id) === String(planId))?.name || "";
    const renewal = calcRenewalDate(form.join_date, planName);
    setForm((prev) => ({ ...prev, plan_id: planId, renewal_date: renewal }));
  };

  return (
    <AppLayout title="Members">
      {/* Hidden file input for doc upload only (photo now uses Capacitor Camera) */}
      <input ref={docRowInputRef} type="file" className="hidden" onChange={handleDocRowFileSelected} />

      <div className="flex flex-wrap gap-3 mb-5 items-center justify-between">
        <div className="flex gap-3 flex-wrap">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, phone, email…" />
          <select
            className="input w-36"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            style={{ WebkitAppearance: "none" }}
          >
            {STATUS_OPTS.map((o) => (
              <option key={o.value} value={o.value} className="bg-surface-card">{o.label}</option>
            ))}
          </select>
        </div>
        <Button onClick={openAdd}><Plus size={15} /> Add Member</Button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? <Spinner /> : members.length === 0 ? <EmptyState message="No members found" /> : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted/40">
                  <tr>
                    <th className="table-th">ID</th>
                    <th className="table-th">Member</th>
                    <th className="table-th hidden sm:table-cell">Phone</th>
                    <th className="table-th hidden md:table-cell">Plan</th>
                    <th className="table-th hidden md:table-cell">Renewal</th>
                    <th className="table-th">Status</th>
                    <th className="table-th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, index) => (
                    <tr key={m.id} className="table-row">
                      <td className="table-td text-gray-400 text-sm">{total - serialOffset - index}</td>
                      <td className="table-td">
                        <div className="flex items-center gap-3">
                          <MemberAvatar member={m} size={8} onClick={() => m.photo_url && setPreviewImage(m.photo_url)} />
                          <div>
                            <p className="font-medium text-gray-100">{m.name}</p>
                            <p className="text-xs text-gray-500 sm:hidden">{m.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-td hidden sm:table-cell text-gray-400">{m.phone}</td>
                      <td className="table-td hidden md:table-cell text-gray-400">{m.plan?.name || "—"}</td>
                      <td className="table-td hidden md:table-cell">
                        {(() => {
                          const info = getRenewalInfo(m.renewal_date);
                          return info
                            ? <span className={`text-xs font-medium ${info.cls}`}>{info.label}</span>
                            : <span className="text-gray-500">—</span>;
                        })()}
                      </td>
                      <td className="table-td">
                        <MemberStatusBadge member={m} />
                      </td>
                      <td className="table-td text-right">
                        <div className="flex justify-end items-center gap-1">
                          {/* Camera photo button — opens device camera via Capacitor */}
                          <button
                            onClick={() => takePhoto(m)}
                            disabled={photoUploading === m.id}
                            className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors disabled:opacity-50"
                            title="Take Photo"
                          >
                            {photoUploading === m.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <CameraIcon size={14} />}
                          </button>
                          {/* Upload document */}
                          <button
                            onClick={() => triggerDocUpload(m)}
                            className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                            title="Upload Document"
                          >
                            <Upload size={14} />
                          </button>
                          {/* View member */}
                          <button
                            onClick={() => setViewModal(m)}
                            className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                            title="View Member"
                          >
                            <Eye size={14} />
                          </button>
                          {/* View documents */}
                          <button
                            onClick={() => setDocsModal(m)}
                            className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                            title="View Documents"
                          >
                            <FolderOpen size={14} />
                          </button>
                          {/* Edit */}
                          <button onClick={() => openEdit(m)} className="p-1.5 rounded-md text-gray-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors">
                            <Edit2 size={14} />
                          </button>
                          {/* Delete */}
                          {canDelete && (
                            <button onClick={() => setDeleteId(m.id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-surface-border">
              {members.map((m, index) => (
                <div key={m.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <MemberAvatar member={m} size={12} onClick={() => m.photo_url && setPreviewImage(m.photo_url)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="font-semibold text-gray-100 text-sm">{m.name}</p>
                        <MemberStatusBadge member={m} />
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{m.phone}</p>
                      <p className="text-xs text-gray-500">ID: {total - serialOffset - index}</p>
                      {m.plan?.name && <p className="text-xs text-gray-500">{m.plan.name}</p>}
                      {m.renewal_date && (() => {
                        const info = getRenewalInfo(m.renewal_date);
                        return info
                          ? <p className={`text-xs font-medium ${info.cls}`}>{info.label}</p>
                          : null;
                      })()}
                      {/* Mobile action buttons */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {/* Camera photo button — opens device camera via Capacitor */}
                        <button
                          onClick={() => takePhoto(m)}
                          disabled={photoUploading === m.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-surface-border text-xs text-gray-400 hover:text-brand-400 hover:border-brand-500/40 transition-colors disabled:opacity-50"
                        >
                          {photoUploading === m.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <CameraIcon size={11} />}
                          Photo
                        </button>
                        <button
                          onClick={() => triggerDocUpload(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-surface-border text-xs text-gray-400 hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                        >
                          <Upload size={11} /> Upload Doc
                        </button>
                        <button
                          onClick={() => setViewModal(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-surface-border text-xs text-gray-400 hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                        >
                          <Eye size={11} /> View
                        </button>
                        <button
                          onClick={() => setDocsModal(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-surface-border text-xs text-gray-400 hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                        >
                          <FolderOpen size={11} /> View Docs
                        </button>
                        <button
                          onClick={() => openEdit(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-surface-border text-xs text-gray-400 hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                        >
                          <Edit2 size={11} /> Edit
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setDeleteId(m.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-muted border border-red-500/20 text-xs text-gray-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Pagination page={page} total={total} limit={20} onPage={setPage} />

      {/* Add/Edit Member Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Edit Member" : "Add Member"} width="max-w-xl">
        <form onSubmit={save} className="grid grid-cols-2 gap-4">
          <FormField label="Full name *" className="col-span-2">
            <input type="text" required className="input" value={form.name} onChange={set("name")} />
          </FormField>
          <FormField label="Phone *">
            <input type="tel" required className="input" value={form.phone} onChange={set("phone")} />
          </FormField>
          <FormField label="Email">
            <input type="email" className="input" value={form.email} onChange={set("email")} />
          </FormField>
          <FormField label="Gender">
            <Select options={GENDER_OPTS} value={form.gender} onChange={set("gender")} />
          </FormField>
          <FormField label="Age">
            <input
              type="number"
              min="1"
              max="120"
              className="input"
              placeholder="Enter age"
              value={form.age || ""}
              onChange={set("age")}
            />
          </FormField>
          <FormField label="Plan">
            <Select options={planOpts} value={form.plan_id} onChange={handlePlanChange} />
          </FormField>
          <FormField label="Status">
            <Select options={STATUS_OPTS.slice(1)} value={form.status} onChange={set("status")} />
          </FormField>
          <FormField label="Join date">
            <input type="date" className="input" value={form.join_date} onChange={handleJoinDateChange} />
          </FormField>
          <FormField label="Renewal date (auto)">
            <input
              type="date"
              className="input opacity-70 cursor-not-allowed"
              value={form.renewal_date}
              readOnly
              tabIndex={-1}
            />
          </FormField>
          <FormField label="Address" className="col-span-2">
            <input type="text" className="input" value={form.address} onChange={set("address")} />
          </FormField>
          <div className="col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save changes" : "Add member"}</Button>
          </div>
        </form>
      </Modal>

      {/* Documents Modal */}
      <DocumentsModal
        member={docsModal}
        open={!!docsModal}
        onClose={() => setDocsModal(null)}
      />

      {/* View Member Modal */}
      <MemberViewModal
        member={viewModal}
        open={!!viewModal}
        onClose={() => setViewModal(null)}
      />

      {/* Row-level doc upload meta modal */}
      <DocMetaModal
        open={rowDocMetaOpen}
        onClose={handleRowDocMetaClose}
        onConfirm={handleRowDocMetaConfirm}
        uploading={rowDocUploading}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={deleteMember}
        message="Delete this member? This cannot be undone."
      />

      {/* Photo preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-fade-in"
          onClick={() => setPreviewImage(null)}
          style={{ animation: "fadeIn 0.2s ease" }}
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-gray-300 transition-colors"
            onClick={() => setPreviewImage(null)}
            aria-label="Close preview"
          >
            &times;
          </button>
          <img
            src={previewImage}
            alt="Member photo"
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={[
          { label: "Add Member",     icon: UserPlus,        onClick: openAdd },
          { label: "Edit Member",    icon: Edit2,           onClick: () => {
              if (members.length > 0) openEdit(members[0]);
              else toast.error("No members to edit");
          }},
          { label: "Export Members", icon: FileSpreadsheet, onClick: exportMembers },
        ]}
      />
    </AppLayout>
  );
}

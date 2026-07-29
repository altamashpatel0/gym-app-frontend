import axios from "axios";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "https://gym-app-backend-ecff.onrender.com",
  withCredentials: false,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("gymops_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("gymops_token");
      localStorage.removeItem("gymops_user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (data) => client.post("/api/auth/login", data),
  register: (data) => client.post("/api/auth/register", data),
  me: () => client.get("/api/auth/me"),
  forgotPassword: (email) => client.post("/api/auth/forgot-password", { email }),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardAPI = {
  // NEW: both accept an optional { shift: "Day" | "Night" } param so the
  // dashboard can scope every stat to a shift. Omitting it (or passing {})
  // keeps the old "all members" behavior.
  stats: (params) => client.get("/api/dashboard/stats", { params }),
  expiringMembers: (params) => client.get("/api/dashboard/expiring-members", { params }),
};

// ── Members ───────────────────────────────────────────────────────────────────
export const membersAPI = {
  list: (params) => client.get("/api/members", { params }),
  get: (id) => client.get(`/api/members/${id}`),
  create: (data) => client.post("/api/members", data),
  update: (id, data) => client.put(`/api/members/${id}`, data),
  delete: (id) => client.delete(`/api/members/${id}`),
  dueMember: () => client.get("/api/members/due-members"),
  // ── Attendance Pause (NEW) — separate from member status ─────────────────
  pauseAttendance: (id, reason) => client.patch(`/api/members/${id}/pause-attendance`, { reason }),
  resumeAttendance: (id) => client.patch(`/api/members/${id}/resume-attendance`),
};

// ── Plans ─────────────────────────────────────────────────────────────────────
export const plansAPI = {
  list: () => client.get("/api/plans"),
  create: (data) => client.post("/api/plans", data),
  update: (id, data) => client.put(`/api/plans/${id}`, data),
  delete: (id) => client.delete(`/api/plans/${id}`),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsAPI = {
  list: (params) => client.get("/api/payments", { params }),
  collect: (data) => client.post("/api/payments", data),
  update: (id, data) => client.put(`/api/payments/${id}`, data),
  delete: (id) => client.delete(`/api/payments/${id}`),
  pendingDues: () => client.get("/api/payments/pending-dues"),
};

// ── Attendance ────────────────────────────────────────────────────────────────
export const attendanceAPI = {
  today: () => client.get("/api/attendance/today"),
  list: (params) => client.get("/api/attendance", { params }),
  mark: (member_id) => client.post("/api/attendance", { member_id }),
  checkout: (id) => client.put(`/api/attendance/${id}/checkout`),
  delete: (id) => client.delete(`/api/attendance/${id}`),
};

// ── Staff ─────────────────────────────────────────────────────────────────────
export const staffAPI = {
  list: () => client.get("/api/staff"),
  create: (data) => client.post("/api/staff", data),
  update: (id, data) => client.put(`/api/staff/${id}`, data),
  delete: (id) => client.delete(`/api/staff/${id}`),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsAPI = {
  revenue: (params) => client.get("/api/reports/revenue", { params }),
  activeMembers: () => client.get("/api/reports/active-members"),
  dueMembers: () => client.get("/api/reports/due-members"),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsAPI = {
  list: () => client.get("/api/notifications"),
  markRead: (id) => client.post(`/api/notifications/${id}/read`),
  markAllRead: () => client.post("/api/notifications/read-all"),
};

// ── Media ─────────────────────────────────────────────────────────────────────
export const mediaAPI = {
  // FIX: backend expects field name "photo" (not "file")
  uploadPhoto: (memberId, file) => {
    const fd = new FormData();
    fd.append("photo", file);
    return client.post(`/api/members/${memberId}/photo`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // FIX: backend expects "document" (UploadFile), "document_name" (Form), "document_type" (Form)
  uploadDocument: (memberId, file, documentName, documentType) => {
    const fd = new FormData();
    fd.append("document", file);
    fd.append("document_name", documentName);
    fd.append("document_type", documentType);
    return client.post(`/api/members/${memberId}/documents`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  getDocuments: (memberId) => client.get(`/api/members/${memberId}/documents`),
  deleteDocument: (documentId) => client.delete(`/api/documents/${documentId}`),
};

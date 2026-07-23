import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, LogIn, LogOut, Eye, Phone, Clock, Calendar, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  Button, Modal, Select, EmptyState, Skeleton, ErrorState,
} from "../../components/ui/index";
import { attendanceAPI, membersAPI } from "../../api/client";

// ── Filter dropdown options ──────────────────────────────────────────────────
const STATUS_FILTER_OPTS = [
  { value: "", label: "All" },
  { value: "IN", label: "IN" },
  { value: "OUT", label: "OUT" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Format a minute count as "1 Hr 20 Min" / "45 Min" / "2 Hr".
function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0 Min";
  const hrs = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hrs > 0 && mins > 0) return `${hrs} Hr ${mins} Min`;
  if (hrs > 0) return `${hrs} Hr`;
  return `${mins} Min`;
}

// Given all of today's attendance records for one member, work out their
// current status, total workout duration so far today, first check-in and
// (if they're OUT) most recent check-out — all derived purely from backend
// data, nothing invented on the frontend.
function summarizeToday(records) {
  const sorted = [...records].sort((a, b) => new Date(a.check_in) - new Date(b.check_in));
  const last = sorted[sorted.length - 1];
  const isIn = !!last && !last.check_out;

  const totalMinutes = sorted.reduce((sum, r) => {
    const start = new Date(r.check_in);
    const end = r.check_out ? new Date(r.check_out) : new Date();
    return sum + Math.max(0, (end - start) / 60000);
  }, 0);

  return {
    status: isIn ? "IN" : "OUT",
    activeRecord: isIn ? last : null,
    totalMinutes,
    firstCheckIn: sorted[0]?.check_in || null,
    lastCheckOut: [...sorted].reverse().find((r) => r.check_out)?.check_out || null,
    records: sorted,
  };
}

function initialsOf(name) {
  return name
    ? name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function MemberPhoto({ member, size = "card" }) {
  const [imgError, setImgError] = useState(false);
  const sizeCls = size === "modal" ? "w-20 h-20 text-base" : "w-16 h-16 text-sm";

  if (member.photo_url && !imgError) {
    return (
      <img
        src={member.photo_url}
        alt={member.name}
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover shrink-0 border border-surface-border`}
      />
    );
  }
  return (
    <div className={`${sizeCls} rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0`}>
      <span className="font-bold text-brand-400">{initialsOf(member.name)}</span>
    </div>
  );
}

// ── Status badge (IN = green, OUT = red) ─────────────────────────────────────
function StatusBadge({ status }) {
  const cls = status === "IN"
    ? "bg-green-500/15 text-green-400 border border-green-500/20"
    : "bg-red-500/15 text-red-400 border border-red-500/20";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "IN" ? "bg-green-400" : "bg-red-400"}`} />
      {status}
    </span>
  );
}

// ── Attendance card ───────────────────────────────────────────────────────────
function AttendanceCard({ member, summary, actioning, onToggle, onViewInfo }) {
  const { status, totalMinutes } = summary;
  const isIn = status === "IN";

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <MemberPhoto member={member} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-100 truncate">{member.name}</p>
          <p className="text-xs text-gray-500">Member ID: {member.id}</p>
          <div className="mt-1.5">
            <StatusBadge status={status} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400 bg-surface-muted/50 rounded-lg px-3 py-2">
        <Clock size={13} className="text-gray-500 shrink-0" />
        <span>Today's Workout: <span className="text-gray-200 font-medium">{formatDuration(totalMinutes)}</span></span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-auto">
        <Button
          variant={isIn ? "danger" : "primary"}
          loading={actioning}
          onClick={() => onToggle(member, summary)}
          className="w-full sm:flex-1 justify-center text-xs py-2"
        >
          {isIn ? <LogOut size={14} /> : <LogIn size={14} />}
          {isIn ? "Check Out" : "Check In"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => onViewInfo(member)}
          className="w-full sm:flex-1 justify-center text-xs py-2"
        >
          <Eye size={14} /> View Info
        </Button>
      </div>
    </div>
  );
}

// ── Card skeleton (loading state) ────────────────────────────────────────────
function AttendanceCardSkeleton() {
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
      <Skeleton className="h-8 w-full rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

// ── View Info modal ───────────────────────────────────────────────────────────
function InfoModal({ member, summary, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!member) return;
    setLoading(true);
    setError(false);
    try {
      const { data } = await attendanceAPI.list({ member_id: member.id });
      const all = Array.isArray(data) ? data : data.items || [];
      const mine = all.filter((r) => (r.member?.id ?? r.member_id) === member.id);
      mine.sort((a, b) => new Date(b.check_in) - new Date(a.check_in));
      setHistory(mine);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [member]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  if (!member) return null;

  return (
    <Modal open={!!member} onClose={onClose} title="Member Attendance Info" width="max-w-md">
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
          <StatusBadge status={summary.status} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Check In</p>
          <p className="text-xs font-medium text-gray-200">
            {summary.firstCheckIn ? format(new Date(summary.firstCheckIn), "hh:mm a") : "—"}
          </p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Check Out</p>
          <p className="text-xs font-medium text-gray-200">
            {summary.lastCheckOut ? format(new Date(summary.lastCheckOut), "hh:mm a") : "—"}
          </p>
        </div>
        <div className="bg-surface-muted/50 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Duration</p>
          <p className="text-xs font-medium text-gray-200">{formatDuration(summary.totalMinutes)}</p>
        </div>
      </div>

      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Attendance History</p>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState message="Couldn't load attendance history" onRetry={loadHistory} />
      ) : history.length === 0 ? (
        <EmptyState message="No attendance history yet" />
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {history.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-surface-muted/40 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Calendar size={12} className="text-gray-500" />
                {format(new Date(r.check_in), "dd MMM yyyy")}
              </div>
              <div className="text-gray-300">
                {format(new Date(r.check_in), "hh:mm a")} – {r.check_out ? format(new Date(r.check_out), "hh:mm a") : "In gym"}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const [members, setMembers] = useState([]);
  const [todayRecords, setTodayRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actioningId, setActioningId] = useState(null);
  const [infoMember, setInfoMember] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [membersRes, attRes] = await Promise.all([
        membersAPI.list({ status: "active", limit: 10000 }),
        attendanceAPI.today(),
      ]);
      const rawMembers = membersRes.data;
      setMembers(Array.isArray(rawMembers) ? rawMembers : rawMembers.items || []);
      const rawAtt = attRes.data;
      setTodayRecords(Array.isArray(rawAtt) ? rawAtt : rawAtt.items || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Silent background re-sync with the backend after a check-in/check-out —
  // keeps every card correct without a visible page reload or spinner.
  const silentRefreshToday = useCallback(async () => {
    try {
      const { data } = await attendanceAPI.today();
      setTodayRecords(Array.isArray(data) ? data : data.items || []);
    } catch {
      // best-effort only; the optimistic update already reflects the action
    }
  }, []);

  const recordsByMember = useMemo(() => {
    const map = new Map();
    for (const r of todayRecords) {
      const id = r.member?.id ?? r.member_id;
      if (id == null) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(r);
    }
    return map;
  }, [todayRecords]);

  const getSummary = useCallback(
    (memberId) => summarizeToday(recordsByMember.get(memberId) || []),
    [recordsByMember]
  );

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      const matchesSearch = !q
        || m.name?.toLowerCase().includes(q)
        || String(m.id).toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (!statusFilter) return true;
      return getSummary(m.id).status === statusFilter;
    });
  }, [members, search, statusFilter, getSummary]);

  const handleToggle = async (member, summary) => {
    setActioningId(member.id);
    try {
      if (summary.status === "OUT") {
        const { data } = await attendanceAPI.mark(member.id);
        toast.success("Checked In Successfully");
        const record = data && data.id != null
          ? data
          : { id: `temp-${Date.now()}`, check_in: new Date().toISOString(), check_out: null, member };
        setTodayRecords((prev) => [...prev, record]);
      } else {
        const record = summary.activeRecord;
        if (!record) {
          toast.error("Already Checked Out");
          return;
        }
        const { data } = await attendanceAPI.checkout(record.id);
        toast.success("Checked Out Successfully");
        const updated = data && data.id != null ? data : { ...record, check_out: new Date().toISOString() };
        setTodayRecords((prev) => prev.map((r) => (r.id === record.id ? updated : r)));
      }
      silentRefreshToday();
    } catch (err) {
      const detail = (err.response?.data?.detail || "").toLowerCase();
      if (detail.includes("already") && detail.includes("in")) {
        toast.error("Already Checked In");
      } else if (detail.includes("already") && detail.includes("out")) {
        toast.error("Already Checked Out");
      } else {
        toast.error(err.response?.data?.detail || "Something went wrong. Please try again.");
      }
    } finally {
      setActioningId(null);
    }
  };

  const inCount = useMemo(
    () => members.filter((m) => getSummary(m.id).status === "IN").length,
    [members, getSummary]
  );

  return (
    <AppLayout title="Attendance">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Gym Attendance</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? "Loading…" : `${members.length} active members · ${inCount} in gym now`}
          </p>
        </div>
        <button
          onClick={loadAll}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search by member name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="sm:w-40"
          options={STATUS_FILTER_OPTS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <AttendanceCardSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="card">
          <ErrorState message="Couldn't load attendance data" onRetry={loadAll} />
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="card">
          <EmptyState message={members.length === 0 ? "No active members found" : "No members match your search"} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredMembers.map((m) => {
            const summary = getSummary(m.id);
            return (
              <AttendanceCard
                key={m.id}
                member={m}
                summary={summary}
                actioning={actioningId === m.id}
                onToggle={handleToggle}
                onViewInfo={setInfoMember}
              />
            );
          })}
        </div>
      )}

      <InfoModal
        member={infoMember}
        summary={infoMember ? getSummary(infoMember.id) : { status: "OUT", totalMinutes: 0 }}
        onClose={() => setInfoMember(null)}
      />
    </AppLayout>
  );
}

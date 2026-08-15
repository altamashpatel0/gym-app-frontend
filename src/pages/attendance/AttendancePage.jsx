import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, LogIn, LogOut, Eye, Phone, Clock, Calendar, RefreshCw, Ban, Users, TrendingUp, UserCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  Button, Modal, Select, EmptyState, Skeleton, ErrorState,
} from "../../components/ui/index";
import { attendanceAPI, membersAPI } from "../../api/client";
import { MemberPhoto } from "../../components/ui/MemberPhoto";

// ── Filter dropdown options ──────────────────────────────────────────────────
const STATUS_FILTER_OPTS = [
  { value: "", label: "All" },
  { value: "IN", label: "IN" },
  { value: "OUT", label: "OUT" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Gym timezone: Asia/Kolkata (IST, UTC+05:30, no DST). We never rely on the
// browser's local timezone to decide which calendar day a record belongs to.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const AVG_ATTENDANCE_DAYS = 30;

// Returns "YYYY-MM-DD" for the IST calendar day that a timestamp falls on,
// regardless of the viewer's browser timezone.
function getISTDateKey(input) {
  const d = new Date(input);
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The last `n` IST calendar-day keys, oldest first, including today.
function getLastNDayKeysIST(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(getISTDateKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

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

// ── Statistic detail row (used inside the "View Details" modal) ─────────────
function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="flex items-center gap-3 bg-surface-muted/50 rounded-lg px-3 py-3">
      <div className="w-9 h-9 rounded-lg bg-surface-muted flex items-center justify-center shrink-0">
        <Icon size={16} className="text-gray-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p className="text-base font-semibold text-gray-100">{value}</p>
        {hint && <p className="text-[10px] text-gray-600 mt-0.5 truncate">{hint}</p>}
      </div>
    </div>
  );
}

// ── Statistics detail modal (opened via "View Details") ─────────────────────
function StatsDetailModal({
  open, onClose, todayCount, avg, avgLoading, avgError, inCount, loading,
}) {
  return (
    <Modal open={open} onClose={onClose} title="Attendance Statistics" width="max-w-sm">
      <div className="space-y-2.5">
        <StatCard
          icon={UserCheck}
          label="Today's Attendance"
          value={loading ? "…" : todayCount}
          hint="Unique members checked in today"
        />
        <StatCard
          icon={TrendingUp}
          label={`Average Daily Attendance (last ${AVG_ATTENDANCE_DAYS} days)`}
          value={avgLoading ? "…" : avgError ? "—" : avg.toFixed(2)}
          hint={avgError ? "Couldn't load 30-day history" : "Unique members per day"}
        />
        <StatCard
          icon={Users}
          label="In Gym Now"
          value={loading ? "…" : inCount}
          hint="Currently checked in"
        />
      </div>
    </Modal>
  );
}

// ── Attendance card ───────────────────────────────────────────────────────────
function AttendanceCard({ member, summary, actioning, onToggle, onViewInfo }) {
  const { status, totalMinutes } = summary;
  const isIn = status === "IN";
  // Attendance Pause only ever blocks a NEW check-in. A member already
  // checked in today (isIn) can still check out normally even if paused.
  const isPaused = !!member.attendance_paused && !isIn;

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <MemberPhoto member={member} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-100 truncate">{member.name}</p>
          <p className="text-xs text-gray-500">Member ID: {member.id}</p>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={status} />
            {member.attendance_paused && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20">
                <Ban size={11} />
                Attendance Paused
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400 bg-surface-muted/50 rounded-lg px-3 py-2">
        <Clock size={13} className="text-gray-500 shrink-0" />
        <span>Today's Workout: <span className="text-gray-200 font-medium">{formatDuration(totalMinutes)}</span></span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-auto">
        <Button
          variant={isPaused ? "secondary" : isIn ? "danger" : "primary"}
          loading={actioning}
          disabled={isPaused}
          onClick={() => { if (!isPaused) onToggle(member, summary); }}
          className={`w-full sm:flex-1 justify-center text-xs py-2 ${
            isPaused ? "!bg-gray-600 !text-gray-300 !border-gray-500/30 !cursor-not-allowed !opacity-100 pointer-events-none" : ""
          }`}
        >
          {isPaused ? <Ban size={14} /> : isIn ? <LogOut size={14} /> : <LogIn size={14} />}
          {isPaused ? "Attendance Paused" : isIn ? "Check Out" : "Check In"}
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
  const [showStatsModal, setShowStatsModal] = useState(false);

  // ── Average Daily Attendance (last 30 days) ─────────────────────────────
  // Reuses the existing GET /api/attendance list endpoint (attendanceAPI.list)
  // instead of a dedicated stats endpoint. See the note in the chat response
  // about what the backend should support for this to be efficient.
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const dayKeys = getLastNDayKeysIST(AVG_ATTENDANCE_DAYS);
      const start_date = dayKeys[0];
      const end_date = dayKeys[dayKeys.length - 1];
      // start_date/end_date/limit are passed in case the backend supports
      // them; the result is also filtered client-side below, so correctness
      // doesn't depend on the backend honoring these params.
      const { data } = await attendanceAPI.list({ start_date, end_date, limit: 10000 });
      const all = Array.isArray(data) ? data : data.items || [];
      setHistoryRecords(all);
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Fires independently so the main member grid doesn't wait on it, but
    // still runs on every Refresh click per the requirements.
    loadHistory();
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
  }, [loadHistory]);

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
    if (summary.status === "OUT" && member.attendance_paused) {
      // New check-in blocked while paused. Checkout (the other branch below)
      // is intentionally left untouched — already-checked-in members can
      // still check out normally.
      toast.error("Attendance is paused for this member.");
      return;
    }
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

  // FEATURE 1 — Today's Attendance: count of UNIQUE members with at least
  // one check-in today. recordsByMember is already keyed by member id, so
  // its size is exactly the unique-member count (repeat check-ins by the
  // same member collapse into one map entry).
  const todayUniqueCount = recordsByMember.size;

  // FEATURE 2 — Average Daily Attendance over the last 30 days. For every
  // day in the window, count unique members (by member id) who have a
  // check-in that day, in Asia/Kolkata (IST) — not the browser's timezone.
  // Then average those daily unique counts over the number of days in the
  // window (days with zero attendance still count toward the denominator).
  const avgDailyAttendance = useMemo(() => {
    const dayKeys = getLastNDayKeysIST(AVG_ATTENDANCE_DAYS);
    const keySet = new Set(dayKeys);
    const uniqueByDay = new Map(dayKeys.map((k) => [k, new Set()]));

    for (const r of historyRecords) {
      if (!r.check_in) continue;
      const dayKey = getISTDateKey(r.check_in);
      if (!keySet.has(dayKey)) continue; // outside the 30-day window — ignore
      const memberId = r.member?.id ?? r.member_id;
      if (memberId == null) continue;
      uniqueByDay.get(dayKey).add(memberId);
    }

    let total = 0;
    for (const set of uniqueByDay.values()) total += set.size;
    return total / AVG_ATTENDANCE_DAYS;
  }, [historyRecords]);

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

      <div className="mb-5">
        <div className="flex sm:justify-end">
          <button
            onClick={() => setShowStatsModal(true)}
            className="w-full sm:w-auto text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 transition-colors"
          >
            View Details
          </button>
        </div>
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

      <StatsDetailModal
        open={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        todayCount={todayUniqueCount}
        avg={avgDailyAttendance}
        avgLoading={historyLoading}
        avgError={historyError}
        inCount={inCount}
        loading={loading}
      />
    </AppLayout>
  );
}

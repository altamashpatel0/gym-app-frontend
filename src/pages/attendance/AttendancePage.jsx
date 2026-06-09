// ─────────────────────────────────────────────────────────────────────────────
// DIFF SUMMARY — AttendancePage.jsx
//
// Added:
//   1. import { FileSpreadsheet } from "lucide-react"               (line ~2)
//   2. import { exportToExcel } from "../../utils/exportExcel"      (line ~10)
//   3. exportAttendance() function                                   (new fn)
//   4. "Export Attendance" action added to fabActions array
//
// Everything else is UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import {
  UserCheck, LogOut, Search, Calendar, Trash2, FileSpreadsheet,  // ← added FileSpreadsheet
} from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button, Badge, Spinner, EmptyState } from "../../components/ui/index";
import { attendanceAPI, membersAPI } from "../../api/client";
import { format } from "date-fns";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";
import { exportToExcel } from "../../utils/exportExcel";  // ← added

export default function AttendancePage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [marking, setMarking] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);

  const searchInputRef = useState(null);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const { data } = await attendanceAPI.list({ date });
      setRecords(Array.isArray(data) ? data : data.items || []);
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, [date]);

  const searchMembers = async (q) => {
    setMemberSearch(q);
    if (q.length < 2) { setMemberResults([]); return; }
    setSearching(true);
    try {
      const { data } = await membersAPI.list({ search: q, status: "active", limit: 8 });
      setMemberResults(data.items || []);
    } catch {
      setMemberResults([]);
    } finally {
      setSearching(false);
    }
  };

  const markCheckIn = async (member_id) => {
    setMarking(member_id);
    try {
      await attendanceAPI.mark(member_id);
      toast.success("Checked in!");
      setMemberSearch("");
      setMemberResults([]);
      if (date === format(new Date(), "yyyy-MM-dd")) loadRecords();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Already checked in today");
    } finally {
      setMarking(null);
    }
  };

  const markCheckOut = async (record) => {
    setMarking(record.id);
    try {
      await attendanceAPI.checkout(record.id);
      toast.success("Checked out!");
      loadRecords();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Checkout failed");
    } finally {
      setMarking(null);
    }
  };

  const deleteRecord = async (record) => {
    setConfirmDelete(null);
    try {
      await attendanceAPI.delete(record.id);
      toast.success("Record deleted");
      loadRecords();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete record");
    }
  };

  const focusSearch = () => {
    const el = document.getElementById("attendance-search-input");
    if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  };

  const promptDeleteLatest = () => {
    const inGym = records.find((r) => !r.check_out);
    if (inGym) {
      setConfirmDelete(inGym);
    } else if (records.length > 0) {
      setConfirmDelete(records[0]);
    } else {
      toast.error("No attendance records to delete");
    }
  };

  // ── NEW: Export attendance to Excel ───────────────────────────────────────
  const exportAttendance = () => {
    if (!records || records.length === 0) {
      toast.error("No attendance records to export");
      return;
    }

    const rows = records.map((r) => {
      const durationMin = r.check_out
        ? Math.round((new Date(r.check_out) - new Date(r.check_in)) / 60000)
        : null;

      return {
        "Member ID":   r.member?.id || "",
        "Member Name": r.member?.name || "",
        "Phone":       r.member?.phone || "",
        "Check In":    r.check_in ? format(new Date(r.check_in), "hh:mm a") : "",
        "Check Out":   r.check_out ? format(new Date(r.check_out), "hh:mm a") : "Still in gym",
        "Duration":    durationMin != null ? `${durationMin} min` : "—",
        "Date":        r.check_in ? format(new Date(r.check_in), "dd MMM yyyy") : date,
      };
    });

    const fileName = `Attendance_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    exportToExcel(rows, fileName);
    toast.success("Attendance exported!");
  };
  // ─────────────────────────────────────────────────────────────────────────

  const isToday = date === format(new Date(), "yyyy-MM-dd");

  const fabActions = [
    {
      label: "Mark Attendance",
      icon: UserCheck,
      onClick: focusSearch,
    },
    {
      label: "Delete Attendance Record",
      icon: Trash2,
      variant: "danger",
      onClick: promptDeleteLatest,
    },
    {
      label: "Export Attendance",       // ← NEW
      icon: FileSpreadsheet,
      onClick: exportAttendance,
    },
  ];

  return (
    <AppLayout title="Attendance">
      {/* Check-in bar (today only) — unchanged */}
      {isToday && (
        <div className="card mb-5">
          <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Mark Check-in</p>
          <div className="relative">
            <div className="flex items-center gap-2 input pr-3">
              <Search size={14} className="text-gray-500 shrink-0" />
              <input
                id="attendance-search-input"
                type="text"
                className="flex-1 bg-transparent outline-none text-sm text-gray-200 placeholder-gray-600"
                placeholder="Search member by name or phone…"
                value={memberSearch}
                onChange={(e) => searchMembers(e.target.value)}
                autoComplete="off"
              />
              {searching && <span className="text-xs text-gray-500">…</span>}
            </div>
            {memberResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface-card border border-surface-border rounded-xl shadow-2xl z-20 overflow-hidden">
                {memberResults.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-surface-muted cursor-pointer transition-colors"
                    onClick={() => markCheckIn(m.id)}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-200">{m.name}</p>
                      <p className="text-xs text-gray-500">{m.phone} · {m.plan?.name || "No plan"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge type={m.status} label={m.status} />
                      {marking === m.id ? (
                        <span className="text-xs text-gray-500">…</span>
                      ) : (
                        <UserCheck size={15} className="text-brand-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Date filter + header — unchanged */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">
            {isToday ? "Today's Attendance" : `Attendance — ${format(new Date(date + "T00:00:00"), "dd MMM yyyy")}`}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{records.length} check-ins</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-500" />
          <input
            type="date"
            className="input w-40"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={format(new Date(), "yyyy-MM-dd")}
          />
        </div>
      </div>

      {/* Delete confirmation dialog — unchanged */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-card border border-surface-border rounded-2xl shadow-2xl p-6 w-80">
            <p className="text-sm font-semibold text-gray-200 mb-1">Delete attendance record?</p>
            <p className="text-xs text-gray-500 mb-5">
              {confirmDelete.member?.name} · {format(new Date(confirmDelete.check_in), "hh:mm a")}
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" className="text-xs px-4 py-1.5" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="text-xs px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white border-red-600"
                onClick={() => deleteRecord(confirmDelete)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Records table — unchanged */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : records.length === 0 ? (
          <EmptyState message="No attendance records for this date" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-muted/40">
                <tr>
                  <th className="table-th">#</th>
                  <th className="table-th">Member</th>
                  <th className="table-th hidden sm:table-cell">Plan</th>
                  <th className="table-th">Check-in</th>
                  <th className="table-th hidden md:table-cell">Check-out</th>
                  <th className="table-th hidden md:table-cell">Duration</th>
                  <th className="table-th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, index) => {
                  const duration = r.check_out
                    ? Math.round((new Date(r.check_out) - new Date(r.check_in)) / 60000)
                    : null;
                  return (
                    <tr key={r.id} className="table-row">
                      <td className="table-td text-gray-500 text-xs font-mono">
                        {index + 1}
                      </td>
                      <td className="table-td">
                        <p className="font-medium text-gray-100">{r.member?.name || "—"}</p>
                        <p className="text-xs text-gray-500">{r.member?.phone}</p>
                      </td>
                      <td className="table-td hidden sm:table-cell text-gray-400 text-xs">
                        {r.member?.plan?.name || "—"}
                      </td>
                      <td className="table-td text-gray-300 text-sm">
                        {format(new Date(r.check_in), "hh:mm a")}
                      </td>
                      <td className="table-td hidden md:table-cell text-gray-400 text-sm">
                        {r.check_out ? format(new Date(r.check_out), "hh:mm a") : (
                          <Badge type="active" label="In gym" />
                        )}
                      </td>
                      <td className="table-td hidden md:table-cell text-gray-400 text-xs">
                        {duration != null ? `${duration} min` : "—"}
                      </td>
                      <td className="table-td text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isToday && !r.check_out && (
                            <Button
                              variant="secondary"
                              className="text-xs px-3 py-1.5"
                              loading={marking === r.id}
                              onClick={() => markCheckOut(r)}
                            >
                              <LogOut size={13} /> Check-out
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            className="text-xs px-2 py-1.5 text-red-400 border-red-900/40 hover:bg-red-900/20 hover:border-red-700"
                            onClick={() => setConfirmDelete(r)}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={fabActions}
      />
    </AppLayout>
  );
}

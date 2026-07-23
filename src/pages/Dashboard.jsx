import { useEffect, useState } from "react";
import { Users, UserCheck, Clock, Banknote, AlertTriangle, UserX, UserPlus, CreditCard, ClipboardList, UserCog } from "lucide-react";
import { AppLayout } from "../components/layout/AppLayout";
import { StatCard, Spinner, Badge } from "../components/ui";
import { dashboardAPI, attendanceAPI, membersAPI } from "../api/client";
import { format } from "date-fns";
import { FloatingActionMenu } from "../components/ui/FloatingActionMenu";
import { getMemberStatus, getDaysLeft } from "../utils/renewal";

// NEW: dashboard-level shift filter options ("All" plus the two shifts)
const DASHBOARD_SHIFT_TABS = [
  { value: "", label: "All" },
  { value: "Day", label: "Day" },
  { value: "Night", label: "Night" },
];

export default function Dashboard() {
  const [allMembers, setAllMembers] = useState([]);
  const [todayAtt, setTodayAtt] = useState([]);
  const [collectionStats, setCollectionStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState(""); // NEW — "" = All, "Day", or "Night"

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // NEW: shift param scopes the member list + stats totals; omitted
        // (empty string) means "All" and matches prior behavior.
        const shiftParams = shiftFilter ? { shift: shiftFilter } : {};

        const [membersRes, att, statsRes] = await Promise.all([
          membersAPI.list({ limit: 10000, page: 1, ...shiftParams }),
          attendanceAPI.today(),
          dashboardAPI.stats(shiftParams).catch(() => ({ data: null })),
        ]);

        const raw = membersRes.data;
        const members = Array.isArray(raw)
          ? raw
          : raw?.items ?? raw?.data ?? raw?.members ?? [];

        setAllMembers(members);
        setTodayAtt(att.data.slice(0, 8));
        setCollectionStats(statsRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shiftFilter]);

  const totalMembers   = allMembers.length;
  const activeMembers  = allMembers.filter((m) => getMemberStatus(m) === "active").length;
  const expiredMembers = allMembers.filter((m) => getMemberStatus(m) === "expired").length;
  const expiring       = allMembers.filter((m) => getMemberStatus(m) === "expiring_soon");

  // FAB actions — navigate to relevant pages/trigger modals via URL or events
  const fabActions = [
    {
      label: "Add Member",
      icon: UserPlus,
      onClick: () => window.location.href = "/members?action=add",
    },
    {
      label: "Add Plan",
      icon: ClipboardList,
      onClick: () => window.location.href = "/plans?action=add",
    },
    {
      label: "Add Payment",
      icon: CreditCard,
      onClick: () => window.location.href = "/payments?action=add",
    },
    {
      label: "Add Staff",
      icon: UserCog,
      onClick: () => window.location.href = "/staff?action=add",
    },
  ];

  if (loading) return <AppLayout title="Dashboard"><Spinner /></AppLayout>;

  return (
    <AppLayout title="Dashboard">
      {/* NEW: shift filter — scopes every stat card + table below to a shift.
          Responsive: full-width segmented control on mobile, fit-content on desktop. */}
      <div className="flex mb-4 bg-surface-muted border border-surface-border rounded-lg p-1 w-full sm:w-fit">
        {DASHBOARD_SHIFT_TABS.map((tab) => (
          <button
            key={tab.value || "all"}
            onClick={() => setShiftFilter(tab.value)}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              shiftFilter === tab.value
                ? "bg-brand-500 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Members"    value={totalMembers}   icon={Users}     color="brand" />
        <StatCard title="Active"           value={activeMembers}  icon={UserCheck} color="green" />
        <StatCard
          title="Expiring Soon"
          value={expiring.length}
          icon={Clock}
          color="yellow"
          sub="within 7 days"
        />
        <StatCard title="Expired"          value={expiredMembers} icon={UserX}     color="red" />
        <StatCard
          title="Today Collection"
          value={`₹${Number(collectionStats?.today_collection || 0).toLocaleString("en-IN")}`}
          icon={Banknote}
          color="green"
        />
        <StatCard
          title="Lifetime Collection"
          value={`₹${Number(collectionStats?.total_revenue || 0).toLocaleString("en-IN")}`}
          icon={Banknote}
          color="green"
        />
        {/* NEW: Day / Night member counts — always computed by the backend
            across all members, independent of the shiftFilter toggle above,
            so the two counts stay meaningful no matter which tab is active. */}
        <StatCard
          title="Day Members"
          value={collectionStats?.day_members ?? 0}
          icon={Clock}
          color="brand"
        />
        <StatCard
          title="Night Members"
          value={collectionStats?.night_members ?? 0}
          icon={Clock}
          color="brand"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        {/* Today's Attendance */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Today's Check-ins</h3>
          {todayAtt.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No check-ins yet today</p>
          ) : (
            <div className="space-y-2">
              {todayAtt.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-1.5">
                  <div>
                    <p className="text-sm font-medium text-gray-200">{a.member?.name}</p>
                    <p className="text-xs text-gray-500">{a.member?.phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">
                      {format(new Date(a.check_in), "hh:mm a")}
                    </p>
                    {a.check_out ? (
                      <span className="text-xs text-gray-500">Out: {format(new Date(a.check_out), "hh:mm a")}</span>
                    ) : (
                      <Badge type="active" label="In gym" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiring Soon Card */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} className="text-yellow-400" />
            <h3 className="text-sm font-semibold text-gray-200">Expiring Soon</h3>
            {expiring.length > 0 && (
              <span className="ml-auto bg-yellow-500/20 text-yellow-400 text-xs font-semibold px-2 py-0.5 rounded-full border border-yellow-500/30">
                {expiring.length} Members Expiring
              </span>
            )}
          </div>
          {expiring.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No memberships expiring this week</p>
          ) : (
            <div className="space-y-2">
              {expiring.slice(0, 5).map((m) => {
                const days = getDaysLeft(m.renewal_date || m.expiry_date);
                return (
                  <div key={m.id || m.member_id} className="flex items-center justify-between py-1.5">
                    <div>
                      <p className="text-sm font-medium text-gray-200">{m.name}</p>
                      <p className="text-xs text-gray-500">{m.phone}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-yellow-400">
                        {(m.renewal_date || m.expiry_date)
                          ? format(new Date(m.renewal_date || m.expiry_date), "dd MMM yyyy")
                          : "—"}
                      </p>
                      {days !== null && (
                        <p className={`text-xs font-semibold ${days <= 0 ? "text-red-400" : days <= 3 ? "text-orange-400" : "text-yellow-500"}`}>
                          {days <= 0 ? "Expired" : `${days}d left`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Members Expiring In Next 7 Days Table */}
      {expiring.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center gap-2">
            <AlertTriangle size={14} className="text-yellow-400" />
            <h3 className="text-sm font-semibold text-gray-200">Members Expiring In Next 7 Days</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-muted/40">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th hidden sm:table-cell">Phone</th>
                  <th className="table-th">Expiry Date</th>
                  <th className="table-th">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((m) => {
                  const days = getDaysLeft(m.renewal_date || m.expiry_date);
                  return (
                    <tr key={m.id || m.member_id} className="table-row">
                      <td className="table-td">
                        <p className="font-medium text-gray-100">{m.name}</p>
                        <p className="text-xs text-gray-500 sm:hidden">{m.phone}</p>
                      </td>
                      <td className="table-td hidden sm:table-cell text-gray-400">{m.phone}</td>
                      <td className="table-td text-yellow-400 text-sm">
                        {(m.renewal_date || m.expiry_date)
                          ? format(new Date(m.renewal_date || m.expiry_date), "dd MMM yyyy")
                          : "—"}
                      </td>
                      <td className="table-td">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                          days === null
                            ? "text-gray-400"
                            : days <= 0
                            ? "bg-red-500/15 text-red-400 border border-red-500/20"
                            : days <= 3
                            ? "bg-orange-500/15 text-orange-400 border border-orange-500/20"
                            : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                        }`}>
                          {days === null ? "—" : days <= 0 ? "Expired" : `${days} days`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FloatingActionMenu
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        actions={fabActions}
      />
    </AppLayout>
  );
}

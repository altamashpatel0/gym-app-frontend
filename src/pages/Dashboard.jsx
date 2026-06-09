import { useEffect, useState } from "react";
import { Users, UserCheck, Clock, Banknote, AlertTriangle, UserX, UserPlus, CreditCard, ClipboardList, UserCog } from "lucide-react";
import { AppLayout } from "../components/layout/AppLayout";
import { StatCard, Spinner, Badge } from "../components/ui";
import { dashboardAPI, attendanceAPI, membersAPI } from "../api/client";
import { format, differenceInDays } from "date-fns";
import { FloatingActionMenu } from "../components/ui/FloatingActionMenu";

// ── Shared renewal logic (must stay identical to MemberList.jsx) ──────────────
function getMemberStatus(member) {
  if (member.status === "expired") return "expired";
  if (member.status === "active" && member.renewal_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const renewal = new Date(member.renewal_date);
    renewal.setHours(0, 0, 0, 0);
    const days = differenceInDays(renewal, today);
    if (days < 0) return "expired";
    if (days <= 7) return "expiring_soon";
  }
  return member.status || "active";
}

function getDaysLeft(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return differenceInDays(d, today);
}

export default function Dashboard() {
  const [allMembers, setAllMembers] = useState([]);
  const [todayAtt, setTodayAtt] = useState([]);
  const [collectionStats, setCollectionStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [membersRes, att, statsRes] = await Promise.all([
          membersAPI.list({ limit: 10000, page: 1 }),
          attendanceAPI.today(),
          dashboardAPI.stats().catch(() => ({ data: null })),
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
  }, []);

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
      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
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

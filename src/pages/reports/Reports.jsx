import { useEffect, useState } from "react";
import { TrendingUp, Users, AlertCircle, Download } from "lucide-react";
import { AppLayout } from "../../components/layout/AppLayout";
import { Spinner, Badge } from "../../components/ui/index";
import { reportsAPI } from "../../api/client";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";
import toast from "react-hot-toast";

function SectionHeader({ icon: Icon, title, count }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-brand-500/15 flex items-center justify-center">
        <Icon size={15} className="text-brand-400" />
      </div>
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {count != null && (
        <span className="ml-auto text-xs text-gray-500">{count} records</span>
      )}
    </div>
  );
}

function RevenueBar({ label, value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-end gap-2 group">
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          ₹{Number(value).toLocaleString("en-IN")}
        </span>
        <div className="w-full rounded-t-md bg-brand-500/20 overflow-hidden" style={{ height: 80 }}>
          <div
            className="w-full bg-brand-500 rounded-t-md transition-all duration-500"
            style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 mt-1">{label}</span>
      </div>
    </div>
  );
}

export default function Reports() {
  const [revenue, setRevenue]     = useState([]);
  const [active, setActive]       = useState([]);
  const [due, setDue]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [months, setMonths]       = useState(6);
  const [fabOpen, setFabOpen]     = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const from = format(startOfMonth(subMonths(new Date(), months - 1)), "yyyy-MM-dd");
        const to   = format(endOfMonth(new Date()), "yyyy-MM-dd");
        const [rev, act, d] = await Promise.all([
          reportsAPI.revenue({ from, to }),
          reportsAPI.activeMembers(),
          reportsAPI.dueMembers(),
        ]);
        setRevenue(Array.isArray(rev.data) ? rev.data : []);
        setActive(Array.isArray(act.data) ? act.data : act.data?.items || []);
        setDue(Array.isArray(d.data) ? d.data : d.data?.items || []);
      } catch {
        // fail silently
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [months]);

  const maxRevenue = Math.max(...revenue.map((r) => r.total || r.amount || 0), 1);
  const totalRevenue = revenue.reduce((s, r) => s + (r.total || r.amount || 0), 0);

  // Simple CSV export of revenue data
  const exportReport = () => {
    try {
      const rows = [
        ["Month", "Revenue (INR)"],
        ...revenue.map((r) => [r.month || r.label || "", r.total || r.amount || 0]),
      ];
      const csv = rows.map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `revenue-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report exported");
    } catch {
      toast.error("Export failed");
    }
  };

  const fabActions = [
    { label: "Export Report", icon: Download, onClick: exportReport },
  ];

  return (
    <AppLayout title="Reports">
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {/* Revenue chart */}
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div>
                <SectionHeader icon={TrendingUp} title="Revenue Overview" />
                <p className="text-2xl font-bold text-white -mt-2">
                  ₹{Number(totalRevenue).toLocaleString("en-IN")}
                  <span className="text-xs font-normal text-gray-500 ml-2">last {months} months</span>
                </p>
              </div>
              <div className="flex gap-2">
                {[3, 6, 12].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      months === m
                        ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                        : "bg-surface-muted text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {m}M
                  </button>
                ))}
              </div>
            </div>
            {revenue.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">No revenue data available</p>
            ) : (
              <div className="flex items-end gap-2 overflow-x-auto pb-2">
                {revenue.map((r, i) => (
                  <RevenueBar
                    key={i}
                    label={r.month || r.label || `M${i + 1}`}
                    value={r.total || r.amount || 0}
                    max={maxRevenue}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* Active members */}
            <div className="card">
              <SectionHeader icon={Users} title="Active Members" count={active.length} />
              {active.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No active members</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {active.map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{m.name}</p>
                        <p className="text-xs text-gray-500">{m.phone} · {m.plan?.name || "—"}</p>
                      </div>
                      <div className="text-right">
                        <Badge type="active" label="active" />
                        {m.renewal_date && (
                          <p className="text-xs text-gray-500 mt-1">
                            Renews {format(new Date(m.renewal_date), "dd MMM")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Due members */}
            <div className="card">
              <SectionHeader icon={AlertCircle} title="Due / Expired Members" count={due.length} />
              {due.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No due or expired members</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {due.map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{m.name}</p>
                        <p className="text-xs text-gray-500">{m.phone} · {m.plan?.name || "—"}</p>
                      </div>
                      <div className="text-right">
                        <Badge type={m.status} label={m.status} />
                        {m.renewal_date && (
                          <p className="text-xs text-red-400 mt-1">
                            Expired {format(new Date(m.renewal_date), "dd MMM")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

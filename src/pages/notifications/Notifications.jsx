import { useEffect, useState } from "react";
import { Bell, CheckCheck, Circle, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button, Spinner, EmptyState } from "../../components/ui/index";
import { notificationsAPI } from "../../api/client";
import { formatDistanceToNow } from "date-fns";
import { FloatingActionMenu } from "../../components/ui/FloatingActionMenu";

const TYPE_COLOR = {
  renewal:    "text-yellow-400 bg-yellow-500/10",
  payment:    "text-green-400 bg-green-500/10",
  membership: "text-brand-400 bg-brand-500/10",
  alert:      "text-red-400 bg-red-500/10",
  info:       "text-gray-400 bg-gray-500/10",
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [marking, setMarking]   = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await notificationsAPI.list();
      setNotifications(Array.isArray(data) ? data : data.items || []);
    } catch {
      toast.error("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    setMarking(id);
    try {
      await notificationsAPI.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      toast.error("Failed to mark as read");
    } finally {
      setMarking(null);
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await notificationsAPI.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Failed to mark all as read");
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fabActions = [
    {
      label: "Mark All Read",
      icon: CheckCheck,
      onClick: markAll,
    },
  ];

  return (
    <AppLayout title="Notifications">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <p className="text-sm text-gray-400">
            {unreadCount > 0 ? (
              <span className="text-brand-400 font-medium">{unreadCount} unread</span>
            ) : (
              "All caught up"
            )}
            {" "}· {notifications.length} total
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" loading={markingAll} onClick={markAll}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : notifications.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-500">
            <Bell size={32} className="opacity-20" />
            <EmptyState message="No notifications yet" />
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {notifications.map((n) => {
              const colorCls = TYPE_COLOR[n.type] || TYPE_COLOR.info;
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                    n.is_read ? "opacity-60" : "hover:bg-surface-muted/30"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colorCls}`}>
                    <Bell size={15} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${n.is_read ? "text-gray-400" : "text-gray-100"}`}>
                      {n.title || n.message}
                    </p>
                    {n.title && n.message && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                    )}
                    <div className="flex items-center gap-1 mt-1.5">
                      <Clock size={11} className="text-gray-600" />
                      <span className="text-xs text-gray-600">
                        {n.created_at
                          ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true })
                          : "Just now"}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 pt-0.5">
                    {!n.is_read ? (
                      <button
                        onClick={() => markRead(n.id)}
                        disabled={marking === n.id}
                        className="text-gray-500 hover:text-brand-400 transition-colors p-1"
                        title="Mark as read"
                      >
                        {marking === n.id ? (
                          <span className="text-xs text-gray-500">…</span>
                        ) : (
                          <Circle size={8} className="fill-brand-400 text-brand-400" />
                        )}
                      </button>
                    ) : (
                      <CheckCheck size={14} className="text-gray-600" />
                    )}
                  </div>
                </div>
              );
            })}
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

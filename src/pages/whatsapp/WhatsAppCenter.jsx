import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Users, CheckSquare, ArrowRight } from "lucide-react";
import { AppLayout } from "../../components/layout/AppLayout";
import { StatCard, Spinner, EmptyState, Button } from "../../components/ui/index";
import { ExpiringMemberCard } from "../../components/whatsapp/ExpiringMemberCard";
import { SendWhatsAppModal } from "../../components/whatsapp/SendWhatsAppModal";
import { membersAPI } from "../../api/client";
import { filterExpiringMembers } from "../../utils/whatsapp";
import { MemberPhoto } from "../../components/ui/MemberPhoto";

export default function WhatsAppCenter() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Same read-only call MemberList already uses (membersAPI.list) — no new
    // API, no backend params. The 7-day expiry filter happens entirely below,
    // on the client.
    membersAPI
      .list({ limit: 10000 })
      .then(({ data }) => {
        if (active) setMembers(data.items || []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const expiringMembers = useMemo(() => filterExpiringMembers(members), [members]);

  // Selection can only ever contain ids currently in the expiring list.
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set(expiringMembers.map((m) => m.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [expiringMembers]);

  const allSelected = expiringMembers.length > 0 && selected.size === expiringMembers.length;

  const toggleMember = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(expiringMembers.map((m) => m.id)));
  };

  const selectedMembers = useMemo(
    () => expiringMembers.filter((m) => selected.has(m.id)),
    [expiringMembers, selected]
  );

  return (
    <AppLayout title="WhatsApp Center">
      <div className="space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            title="Total 7 Days Expiring Members"
            value={expiringMembers.length}
            icon={Users}
            color="yellow"
          />
          <StatCard
            title="Total Selected Members"
            value={selected.size}
            icon={CheckSquare}
            color="brand"
          />
        </div>

        {/* Select all + Next */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-brand-500 cursor-pointer"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={expiringMembers.length === 0}
            />
            Select All ({expiringMembers.length})
          </label>

          <Button onClick={() => setModalOpen(true)} disabled={selected.size === 0}>
            Next <ArrowRight size={15} />
          </Button>
        </div>

        {/* Member cards */}
        {loading ? (
          <Spinner />
        ) : expiringMembers.length === 0 ? (
          <EmptyState message="No members expiring in the next 7 days 🎉" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {expiringMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <MemberPhoto member={m} />
                <div className="min-w-0 flex-1">
                  <ExpiringMemberCard
                    member={m}
                    checked={selected.has(m.id)}
                    onToggle={toggleMember}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SendWhatsAppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        members={selectedMembers}
      />
    </AppLayout>
  );
}

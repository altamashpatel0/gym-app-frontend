import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";

/**
 * FloatingActionMenu
 *
 * Props:
 *   open        – boolean, controlled open state
 *   onToggle    – () => void
 *   actions     – Array<{ label: string, icon: LucideIcon, onClick: () => void, variant?: "danger" }>
 *
 * Usage:
 *   const [fabOpen, setFabOpen] = useState(false);
 *   <FloatingActionMenu
 *     open={fabOpen}
 *     onToggle={() => setFabOpen(o => !o)}
 *     actions={PAGE_ACTIONS}
 *   />
 */
export function FloatingActionMenu({ open, onToggle, actions = [] }) {
  const sheetRef = useRef(null);

  // Close on ESC
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && open) onToggle(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleAction = (action) => {
    onToggle();      // close sheet first
    action.onClick();
  };

  return (
    <>
      {/* ── Backdrop ─────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* ── Bottom sheet ─────────────────────────────────────────────── */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick actions"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          transform: open ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
          willChange: "transform",
        }}
      >
        <div
          style={{
            background: "var(--color-surface-card, #18181b)",
            borderTop: "1px solid var(--color-surface-border, #27272a)",
            borderRadius: "20px 20px 0 0",
            padding: "0 0 calc(env(safe-area-inset-bottom, 0px) + 16px) 0",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
            maxWidth: 480,
            margin: "0 auto",
          }}
        >
          {/* Drag handle */}
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "var(--color-surface-border, #3f3f46)",
              }}
            />
          </div>

          {/* Label */}
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-gray-500, #71717a)",
              padding: "8px 20px 12px",
            }}
          >
            Quick Actions
          </p>

          {/* Action rows */}
          <div style={{ padding: "0 12px" }}>
            {actions.map((action, i) => {
              const Icon = action.icon;
              const isDanger = action.variant === "danger";
              return (
                <button
                  key={i}
                  onClick={() => handleAction(action)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    width: "100%",
                    padding: "14px 12px",
                    borderRadius: 12,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                    color: isDanger
                      ? "var(--color-red-400, #f87171)"
                      : "var(--color-gray-100, #f4f4f5)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isDanger
                      ? "rgba(239,68,68,0.08)"
                      : "var(--color-surface-muted, #27272a)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Icon container */}
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      background: isDanger
                        ? "rgba(239,68,68,0.12)"
                        : "rgba(99,102,241,0.12)",
                      color: isDanger
                        ? "var(--color-red-400, #f87171)"
                        : "var(--color-brand-400, #818cf8)",
                    }}
                  >
                    {Icon && <Icon size={17} />}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{action.label}</span>
                </button>
              );
            })}
          </div>

          {/* Cancel row */}
          <div style={{ padding: "8px 12px 0" }}>
            <button
              onClick={onToggle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "13px 12px",
                borderRadius: 12,
                border: "1px solid var(--color-surface-border, #3f3f46)",
                background: "var(--color-surface-muted, #27272a)",
                cursor: "pointer",
                color: "var(--color-gray-400, #a1a1aa)",
                fontSize: 14,
                fontWeight: 500,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--color-surface-card, #18181b)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--color-surface-muted, #27272a)";
              }}
            >
              <X size={15} />
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* ── FAB ──────────────────────────────────────────────────────── */}
      <button
        onClick={onToggle}
        aria-label={open ? "Close quick actions" : "Open quick actions"}
        aria-expanded={open}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 51,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
          boxShadow: open
            ? "0 0 0 4px rgba(99,102,241,0.25), 0 8px 24px rgba(99,102,241,0.45)"
            : "0 4px 16px rgba(99,102,241,0.4), 0 2px 6px rgba(0,0,0,0.3)",
          transition: "box-shadow 0.2s, transform 0.2s",
          transform: open ? "scale(0.92)" : "scale(1)",
          color: "#fff",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.transform = "scale(1.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = open ? "scale(0.92)" : "scale(1)";
        }}
      >
        <span
          style={{
            display: "flex",
            transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          <Plus size={24} strokeWidth={2.5} />
        </span>
      </button>
    </>
  );
}

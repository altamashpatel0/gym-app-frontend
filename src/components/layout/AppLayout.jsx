import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, CreditCard, Calendar, UserCheck,
  BarChart2, Bell, Dumbbell, LogOut, Menu, X, ChevronRight,
  Settings, MessageCircle
} from "lucide-react";
import { useState } from "react";
import useAuthStore from "../../store/authStore";

const NAV = [
  { to: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { to: "/members",      label: "Members",      icon: Users },
  { to: "/plans",        label: "Plans",        icon: Dumbbell },
  { to: "/payments",     label: "Payments",     icon: CreditCard },
  { to: "/attendance",   label: "Attendance",   icon: UserCheck },
  { to: "/whatsapp",     label: "WhatsApp Center", icon: MessageCircle },
  { to: "/staff",        label: "Staff",        icon: Settings,  roles: ["owner", "admin"] },
  { to: "/reports",      label: "Reports",      icon: BarChart2, roles: ["owner", "admin"] },
  { to: "/notifications", label: "Notifications", icon: Bell },
];

function NavItem({ item, collapsed, user, onClick }) {
  if (item.roles && !item.roles.includes(user?.role)) return null;
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
         ${isActive
           ? "bg-brand-500/15 text-brand-400 border border-brand-500/20"
           : "text-neutral-400 hover:text-white hover:bg-surface-muted"
         }`
      }
    >
      <Icon size={17} className="shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-surface-border">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shrink-0">
          <Dumbbell size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-white text-base tracking-tight">Gym Management Tool</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto text-neutral-500 hover:text-neutral-300 hidden lg:block"
        >
          <ChevronRight size={16} className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto text-neutral-500 hover:text-neutral-300 lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            user={user}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-surface-border px-3 py-3">
        <div className="flex items-center gap-2.5 mb-2 px-2">
          <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-400 shrink-0">
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-neutral-500 capitalize">{user?.role}</p>
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-neutral-400 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-colors"
        >
          <LogOut size={15} />
          {!collapsed && "Logout"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-surface-sidebar border-r border-surface-border h-screen sticky top-0 transition-all duration-300 ${
          collapsed ? "w-16" : "w-56"
        } shrink-0`}
      >
        {content}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface-sidebar border-r border-surface-border">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

function Topbar({ setMobileOpen, title }) {
  const { user } = useAuthStore();
  return (
    <header className="h-14 bg-surface-card border-b border-surface-border flex items-center px-4 gap-3 sticky top-0 z-30">
      <button
        className="lg:hidden text-neutral-400 hover:text-white"
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={20} />
      </button>
      <h1 className="text-sm font-semibold text-white flex-1">{title}</h1>
      <div className="flex items-center gap-2">
        <NavLink to="/notifications" className="relative text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-surface-muted">
          <Bell size={17} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-brand-500 rounded-full" />
        </NavLink>
        <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-400">
          {user?.name?.charAt(0)?.toUpperCase()}
        </div>
      </div>
    </header>
  );
}

export function AppLayout({ children, title }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar setMobileOpen={setMobileOpen} title={title} />
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;

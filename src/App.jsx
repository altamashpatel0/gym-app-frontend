// src/App.jsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import useAuthStore from "./store/authStore";
import { authAPI } from "./api/client";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Dashboard from "./pages/Dashboard";
import MemberList from "./pages/members/MemberList";
import PlanList from "./pages/plans/PlanList";
import PaymentList from "./pages/payments/PaymentList";
import AttendancePage from "./pages/attendance/AttendancePage";
import StaffList from "./pages/staff/StaffList";
import Reports from "./pages/reports/Reports";
import Notifications from "./pages/notifications/Notifications";

function AuthGate({ children }) {
  const { token, hydrated, setAuth, logout, setHydrated } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setHydrated(true);
      return;
    }
    authAPI
      .me()
      .then(({ data }) => {
        setAuth(token, data);
        setHydrated(true);
      })
      .catch(() => {
        logout();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-bg">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return children;
}

function PrivateRoute({ children, roles }) {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: "#161b27", color: "#e5e7eb", border: "1px solid #1e2535", fontSize: "13px" },
          success: { iconTheme: { primary: "#22c55e", secondary: "#161b27" } },
          error:   { iconTheme: { primary: "#ef4444", secondary: "#161b27" } },
        }}
      />
      <AuthGate>
        <Routes>
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route path="/dashboard"     element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/members"       element={<PrivateRoute><MemberList /></PrivateRoute>} />
          <Route path="/plans"         element={<PrivateRoute><PlanList /></PrivateRoute>} />
          <Route path="/payments"      element={<PrivateRoute><PaymentList /></PrivateRoute>} />
          <Route path="/attendance"    element={<PrivateRoute><AttendancePage /></PrivateRoute>} />
          <Route path="/notifications" element={<PrivateRoute><Notifications /></PrivateRoute>} />
          <Route path="/staff"         element={<PrivateRoute roles={["owner","admin"]}><StaffList /></PrivateRoute>} />
          <Route path="/reports"       element={<PrivateRoute roles={["owner","admin"]}><Reports /></PrivateRoute>} />

          <Route path="/"  element={<Navigate to="/dashboard" replace />} />
          <Route path="*"  element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}

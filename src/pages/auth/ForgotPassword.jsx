import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Dumbbell, Loader2, ArrowLeft } from "lucide-react";
import { authAPI } from "../../api/client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      setSent(true);
      toast.success("Reset instructions sent if the email exists.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-bg p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
            <Dumbbell size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white">Gym Management Tool</span>
        </div>

        <div className="card">
          {sent ? (
            <div className="text-center py-4">
              <p className="text-sm text-neutral-300 mb-4">
                If <strong className="text-white">{email}</strong> is registered, you'll receive a reset link shortly.
              </p>
              <Link to="/login" className="text-brand-400 text-sm hover:underline flex items-center justify-center gap-1">
                <ArrowLeft size={13} /> Back to login
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Forgot password?</h2>
              <p className="text-xs text-neutral-500 mb-5">Enter your email and we'll send a reset link.</p>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gym.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Send reset link
                </button>
              </form>
              <Link to="/login" className="mt-4 text-xs text-brand-400 hover:underline flex items-center gap-1">
                <ArrowLeft size={12} /> Back to login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { create } from "zustand";

const useAuthStore = create((set) => ({
  token: localStorage.getItem("gymops_token") || null,
  user: JSON.parse(localStorage.getItem("gymops_user") || "null"),
  hydrated: false,

  setAuth: (token, user) => {
    localStorage.setItem("gymops_token", token);
    localStorage.setItem("gymops_user", JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem("gymops_token");
    localStorage.removeItem("gymops_user");
    set({ token: null, user: null });
    window.location.href = "/login";
  },

  setHydrated: (val) => set({ hydrated: val }),
}));

export default useAuthStore;

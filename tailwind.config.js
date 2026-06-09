/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          400: "#EF4444",
          500: "#DC2626",
          600: "#B91C1C",
        },
        surface: {
          bg:     "#0A0A0A",
          card:   "#1A1A1A",
          muted:  "#1F1F1F",
          border: "#262626",
          sidebar: "#111111",
        },
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./hapogea-preview/**/*.{html,js}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        retro: ['"Press Start 2P"', "monospace"],
      },
    },
  },
  plugins: [],
};

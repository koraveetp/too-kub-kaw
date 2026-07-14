/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Prompt', 'Sarabun', 'system-ui', 'sans-serif'],
        thai: ['IBM Plex Sans Thai', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        kanit: ['Kanit', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

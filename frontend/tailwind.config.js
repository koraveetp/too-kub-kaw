/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans Thai"', '"Open Sans"', 'system-ui', 'sans-serif'],
        thai: ['"Noto Sans Thai"', '"Open Sans"', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        kanit: ['Prompt', '"Noto Sans Thai"', 'sans-serif'],
      },
      colors: {
        wood: {
          DEFAULT: '#8A5A32',
          dark: '#6B4021',
          light: '#A9713D',
        },
        cocoa: '#5A2E14',
        clay: '#7B2D12',
      },
    },
  },
  plugins: [],
}

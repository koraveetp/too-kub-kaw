/** @type {import('tailwindcss').Config} */
export default {
  // The night theme is a class on <body>, not an OS preference, so `dark:`
  // has to follow `.theme-night`. Left on the default `media` strategy the
  // dark: variants only fired when the phone itself was in dark mode, which
  // is how light-grey text ended up on the near-black night menu.
  darkMode: ['selector', '.theme-night'],
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
        // Theme tokens. The values live in the .theme-day / .theme-night
        // blocks of index.css, so `bg-card` is white by day and #241D16 by
        // night without the JSX naming either colour.
        app: 'var(--c-app)',
        strip: {
          DEFAULT: 'var(--c-strip)',
          soft: 'var(--c-strip-soft)',
        },
        card: {
          DEFAULT: 'var(--c-card)',
          hover: 'var(--c-card-hover)',
        },
        raised: {
          DEFAULT: 'var(--c-raised)',
          hover: 'var(--c-raised-hover)',
          ink: 'var(--c-raised-ink)',
        },
        header: {
          ink: 'var(--c-header-ink)',
        },
        logo: 'var(--c-logo)',
        well: {
          DEFAULT: 'var(--c-well)',
          2: 'var(--c-well-2)',
        },
        line: {
          DEFAULT: 'var(--c-line)',
          strong: 'var(--c-line-strong)',
        },
        ink: {
          DEFAULT: 'var(--c-ink)',
          2: 'var(--c-ink-2)',
          3: 'var(--c-ink-3)',
        },
        title: 'var(--c-title)',
        heading: 'var(--c-heading)',
        accent: 'var(--c-accent)',
        link: 'var(--c-link)',
        cta: {
          DEFAULT: 'var(--c-cta)',
          hover: 'var(--c-cta-hover)',
          ink: 'var(--c-cta-ink)',
        },
        add: {
          DEFAULT: 'var(--c-add)',
          hover: 'var(--c-add-hover)',
          ink: 'var(--c-add-ink)',
        },
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

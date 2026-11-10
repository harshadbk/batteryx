/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        volt: { 50: '#e6f6f7', 100: '#c4eaed', 300: '#5cc3cc', 500: '#0e8c99', 600: '#0b7480', 700: '#095c66', 900: '#06343a' },
        heat: { 100: '#fdf0d9', 500: '#c77700', 600: '#a66300' },
        ink: { 950: '#0b1220', 900: '#111a2b', 800: '#1b263b', 700: '#2a364d' },
      },
      boxShadow: { panel: '0 1px 2px rgba(15,23,42,.06), 0 1px 1px rgba(15,23,42,.04)' },
    },
  },
  plugins: [],
}

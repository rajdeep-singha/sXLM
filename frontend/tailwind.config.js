/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F5F5F5',
        surface: '#ffffff',
        'surface-dark': '#2B2644',
        border: '#e5e5e5',
      },
      fontFamily: {
        sans: ['"TT Norms Pro"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      maxWidth: {
        content: '88rem',
      },
    },
  },
  plugins: [],
};

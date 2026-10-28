/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './*.html',
    './guides/**/*.html',
    './js/**/*.js',
    './src/**/*.{ts,js,html}',
    './gn-*.js'
  ],
  theme: {
    extend: {
      colors: {
        gon: {
          emerald: '#0A3A2F',
          'emerald-dark': '#062820',
          'emerald-light': '#0D473A',
          gold: '#C5A869',
          'gold-light': '#DFCA97',
          ivory: '#FBF9F5',
          surface: '#F4EFE6',
          text: '#111618',
          border: '#E8E2D5',
        }
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        montserrat: ['"Montserrat"', 'sans-serif'],
      }
    }
  },
  safelist: [
    'hidden',
    'bg-amber-100',
    'text-amber-800',
    'bg-blue-100',
    'text-blue-800',
    'bg-purple-100',
    'text-purple-800',
    'bg-emerald-100',
    'text-emerald-800',
    'bg-slate-100',
    'text-slate-800',
    'text-slate-500',
    'bg-red-100',
    'text-red-800',
    'bg-amber-50',
    'border-amber-200',
    'text-amber-900',
    'bg-emerald-50',
    'text-emerald-900',
    'border-emerald-200',
    'text-gray-600',
    'border-gray-100',
    'text-gray-800',
    'text-gray-500'
  ],
  plugins: []
};

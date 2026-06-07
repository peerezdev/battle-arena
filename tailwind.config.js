/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: '#0a0e1a',
          panel: '#121a30',
          border: '#1d2740',
          muted: '#7c89a8',
          text: '#e7ecf5',
          green: '#34e29b',
          red: '#ff5c72',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'neon-green': '0 0 8px #34e29b',
        'neon-red': '0 0 8px #ff5c72',
        'neon-green-lg': '0 0 16px #34e29b44',
        'neon-red-lg': '0 0 16px #ff5c7244',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 6px #34e29b55' },
          '50%': { boxShadow: '0 0 16px #34e29baa' },
        },
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme'
export default {
  content: [
    './src/**/*.{html,js,jsx,ts,tsx,mdx}',
    './docs/**/*.{html,js,jsx,ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', ...defaultTheme.fontFamily.sans],
        serif: [...defaultTheme.fontFamily.serif],
        mono: [...defaultTheme.fontFamily.mono],
      },
      animation: {
        'wiggle': 'wiggle .2s ease-in-out infinite',
        'spin-slow': 'spin 16s linear infinite'
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-5deg)' },
          '50%': { transform: 'rotate(5deg)' },
        }
      },
    },
    fontFamily: {
      'display': ['IBM Plex Sans'],
      'body': ['IBM Plex Sans'],
    }
  },
  plugins: [],
}


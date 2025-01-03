/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme'
export default {
  content: [
    "./index.html",
    "./app/**/*.{js,jsx}",
    "./about/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', ...defaultTheme.fontFamily.sans],
        serif: [...defaultTheme.fontFamily.serif],
        mono: [...defaultTheme.fontFamily.mono],
      }
    },
    fontFamily: {
      'display': ['IBM Plex Sans'],
      'body': ['IBM Plex Sans'],
    }
  },
  plugins: [],
}


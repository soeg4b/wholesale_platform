import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Tower Bersama Group blue (from the official logomark).
          50: '#eef4fd',
          500: '#184c9b',
          700: '#123a77',
        },
        accent: {
          500: '#e30613',
        },
      },
    },
  },
  plugins: [],
};

export default config;

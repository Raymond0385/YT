import { readFileSync } from 'node:fs';

// The word animations (pop / bounce / fade) come from src/data/animations.json, the same file the exported
// video is generated from (backend/animation_specs.py), so preview and render play the same motion.
const animationSpecs = JSON.parse(readFileSync(new URL('./src/data/animations.json', import.meta.url), 'utf-8'));

const fmt = (n) => String(Math.round(n * 1000) / 1000);
const wordKeyframes = {};
const wordAnimations = {};
for (const [name, spec] of Object.entries(animationSpecs)) {
  if (!spec || !Array.isArray(spec.keyframes)) continue;
  wordKeyframes[name] = Object.fromEntries(
    spec.keyframes.map((k) => [`${fmt(k.at * 100)}%`, { transform: `scale(${fmt(k.scaleX)}, ${fmt(k.scaleY)})`, opacity: fmt(k.opacity) }])
  );
  // linear between keyframes: libass interpolates linearly too
  wordAnimations[name] = `${name} ${spec.durationMs}ms linear forwards`;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#090d16'
        },
        brand: {
          500: '#6366f1',
          600: '#4f46e5',
          cyan: '#06b6d4',
          yellow: '#facc15'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        komika: ['Komika Axis', 'Impact', 'sans-serif'],
        boldfont: ['The Bold Font', 'Impact', 'sans-serif'],
        montserrat: ['Montserrat', 'sans-serif'],
        poppins: ['Poppins', 'sans-serif'],
        impact: ['Impact', 'sans-serif']
      },
      spacing: {
        '13': '3.25rem',
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      keyframes: {
        ...wordKeyframes,
        glow: {
          '0%, 100%': { filter: 'drop-shadow(0 0 10px currentColor)' },
          '50%': { filter: 'drop-shadow(0 0 25px currentColor)' }
        }
      },
      animation: {
        ...wordAnimations,
        glow: 'glow 1.5s ease-in-out infinite'
      }
    },
  },
  plugins: [],
}

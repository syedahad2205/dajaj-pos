/**
 * DAJAJ brand color tokens — mirrors the web app's inline Tailwind usage.
 * Source: app/admin/finance/closing/page.tsx and globals.
 */
export const colors = {
  // Backgrounds
  pageBg: '#fff8ed',          // bg-[#fff8ed] — warm cream, all finance pages
  white: '#ffffff',
  slate50: '#f8fafc',
  slate100: '#f1f5f9',

  // Brand accent
  orange50: '#fff7ed',
  orange100: '#ffedd5',
  orange200: '#fed7aa',
  orange400: '#fb923c',
  orange600: '#ea580c',       // text-orange-600 — "Finance" label, accents

  // DAJAJ brand red (from logo wordmark)
  brandRed: '#c0392b',

  // Text hierarchy
  slate900: '#0f172a',        // body text, headings
  slate800: '#1e293b',        // bold values
  slate600: '#475569',        // descriptions
  slate500: '#64748b',        // labels
  slate400: '#94a3b8',        // muted / section headers
  slate200: '#e2e8f0',        // borders
  slate50b: '#f8fafc',

  // Semantic
  // Expenses
  rose50: '#fff1f2',
  rose200: '#fecdd3',
  rose600: '#e11d48',
  rose700: '#be123c',

  // Deposits
  sky50: '#f0f9ff',
  sky100: '#e0f2fe',
  sky600: '#0284c7',

  // Locked/success
  emerald50: '#f0fdf4',
  emerald100: '#dcfce7',
  emerald700: '#15803d',

  // Warning/amber
  amber50: '#fffbeb',
  amber100: '#fef3c7',
  amber200: '#fde68a',
  amber800: '#92400e',

  // Error
  rose50e: '#fff1f2',

  // Buttons
  slateBtnBg: '#0f172a',       // bg-slate-900 — primary buttons
  slateBtnHover: '#1e293b',    // hover bg-slate-800

  // Card borders
  cardBorder: '#e2e8f0',       // border-slate-200
  orangeCardBorder: '#fed7aa', // border-orange-200 — header card
};

export const radius = {
  card: 28,       // rounded-[28px]
  inner: 16,      // rounded-2xl
  sm: 8,          // rounded-lg
  full: 9999,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
};

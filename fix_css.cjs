const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf8');

// Ensure root has standard fonts
css = css.replace(/:root \{/, `:root {\n  --font-xs: 0.75rem;\n  --font-sm: 0.875rem;\n  --font-md: 1rem;\n  --font-lg: 1.125rem;\n  --font-xl: 1.25rem;\n  --font-2xl: 1.5rem;\n`);

// Light Theme updates
css = css.replace(/\[data-theme="light"\] \{[^}]*\}/s, () => {
  return `[data-theme="light"] {
  --bg-primary: #f8fafc;
  --bg-secondary: #f1f5f9;
  --bg-tertiary: #e2e8f0;
  
  --bg-surface: rgba(255, 255, 255, 0.75);
  --bg-surface-solid: #ffffff;
  --bg-surface-elevated: #ffffff;
  --bg-surface-hover: #f1f5f9;
  --bg-surface-active: #e2e8f0;
  --bg-glass: rgba(255, 255, 255, 0.6);
  --bg-glass-hover: rgba(255, 255, 255, 0.85);

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --text-disabled: #94a3b8;
  --text-inverse: #ffffff;

  --border: #e2e8f0;
  --border-color: #e2e8f0;
  --border-subtle: #f1f5f9;
  --border-strong: #cbd5e1;

  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-primary: #4f46e5;
  --accent-secondary: #0ea5e9;

  --success: #059669;
  --warning: #d97706;
  --danger: #dc2626;
  --info: #2563eb;

  --gray-50: #f8fafc;
  --gray-100: #f1f5f9;
  --gray-200: #e2e8f0;
  --gray-300: #cbd5e1;
  --gray-400: #94a3b8;
  --gray-500: #64748b;
  --gray-600: #475569;
  --gray-700: #334155;
  --gray-800: #1e293b;
  --gray-900: #0f172a;
}`;
});

// Dark Theme updates
css = css.replace(/\[data-theme="dark"\] \{[^}]*\}/s, () => {
  return `[data-theme="dark"] {
  --bg-primary: #020617; 
  --bg-secondary: #0f172a;
  --bg-tertiary: #1e293b;
  
  --bg-surface: rgba(15, 23, 42, 0.75);
  --bg-surface-solid: #0f172a;
  --bg-surface-elevated: #1e293b;
  --bg-surface-hover: #334155;
  --bg-surface-active: #475569;
  --bg-glass: rgba(15, 23, 42, 0.5);
  --bg-glass-hover: rgba(30, 41, 59, 0.85);

  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --text-disabled: #64748b;
  --text-inverse: #020617;

  --border: #334155;
  --border-color: #334155;
  --border-subtle: #1e293b;
  --border-strong: #475569;

  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-primary: #818cf8;
  --accent-secondary: #38bdf8;

  --success: #10b981;
  --warning: #fbbf24;
  --danger: #ef4444;
  --info: #3b82f6;

  --gray-50: #020617;
  --gray-100: #0f172a;
  --gray-200: #1e293b;
  --gray-300: #334155;
  --gray-400: #475569;
  --gray-500: #64748b;
  --gray-600: #94a3b8;
  --gray-700: #cbd5e1;
  --gray-800: #e2e8f0;
  --gray-900: #f1f5f9;
  
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.6);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.7);
  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.8);

  --primary-50: rgba(99, 102, 241, 0.1);
  --primary-100: rgba(99, 102, 241, 0.15);
  --success-50: rgba(16, 185, 129, 0.15);
  --success-200: rgba(16, 185, 129, 0.25);
  --warning-50: rgba(245, 158, 11, 0.15);
  --warning-200: rgba(245, 158, 11, 0.25);
  --danger-50: rgba(239, 68, 68, 0.15);
  --danger-200: rgba(239, 68, 68, 0.25);
}`;
});

// Table improvements
css = css.replace(/\.table th, \.table td \{[^}]*\}/, `.table th, .table td {\n    padding: 1rem 1.25rem;\n    border-bottom: 1px solid var(--border-color);\n    height: 64px;\n}`);
css = css.replace(/\.table th \{[^}]*\}/, `.table th {\n    font-size: 0.8125rem;\n    font-weight: 700;\n    text-transform: uppercase;\n    letter-spacing: 0.05em;\n    color: var(--text-primary);\n    background: var(--bg-surface-active);\n}`);
css = css.replace(/\[data-theme="dark"\] \.table th \{[^}]*\}/, `[data-theme="dark"] .table th {\n    background: var(--bg-surface-active);\n    color: var(--text-primary);\n}`);

// Add extra text visibility fixes
css += `
/* Global Text & Input Fixes */
input, select, textarea {
  color: var(--text-primary) !important;
  background-color: var(--bg-surface-solid) !important;
  border-color: var(--border-strong) !important;
}
input::placeholder, select::placeholder, textarea::placeholder {
  color: var(--text-muted) !important;
}
input:disabled, select:disabled, textarea:disabled {
  background-color: var(--bg-tertiary) !important;
  color: var(--text-disabled) !important;
  cursor: not-allowed;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2) !important;
}
.badge {
  color: var(--text-primary);
  font-weight: 600;
}
.page-title {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 700;
  color: var(--text-primary);
}
.section-title {
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  font-weight: 600;
  color: var(--text-primary);
}
`;

fs.writeFileSync('src/index.css', css);
console.log('Done CSS');

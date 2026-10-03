const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf8');

css = css.replace(/\.badge \{\n\s*color: var\(--text-primary\);\n\s*font-weight: 600;\n\s*\}/g, '');

css = css.replace(/\.badge \{([^}]*)\}/s, (match, body) => {
    if (body.includes('gap:')) return match;
    return `.badge {${body}\n  gap: 0.25rem;\n  text-transform: uppercase;\n  white-space: nowrap;\n}`;
});

css = css.replace(/\.badge-success \{([^}]*)\}/, `.badge-success { $1 } \n.badge-success::before { content: '✓'; font-weight: bold; }`);
css = css.replace(/\.badge-warning \{([^}]*)\}/, `.badge-warning { $1 } \n.badge-warning::before { content: '⚠'; font-weight: bold; }`);
css = css.replace(/\.badge-danger \{([^}]*)\}/, `.badge-danger { $1 } \n.badge-danger::before { content: '✕'; font-weight: bold; }`);
css = css.replace(/\.badge-primary \{([^}]*)\}/, `.badge-primary { $1 } \n.badge-primary::before { content: 'ℹ'; font-weight: bold; }`);

fs.writeFileSync('src/index.css', css);
console.log('Badges fixed');

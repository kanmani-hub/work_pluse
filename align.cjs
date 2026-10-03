const fs = require('fs');

let code = fs.readFileSync('src/pages/admin/Attendance.tsx', 'utf8');

code = code.replace(/<td><span className="badge badge-gray">{a\.mode}<\/span><\/td>/g, '<td style={{ textAlign: \'center\' }}><span className="badge badge-gray">{a.mode}</span></td>');
code = code.replace(/<td style={{ fontWeight: 500 }}>{a\.clockIn}<\/td>/g, '<td style={{ fontWeight: 500, textAlign: \'center\' }}>{a.clockIn}</td>');
code = code.replace(/<td style={{ fontWeight: 500 }}>\s*{a\.clockOut}/g, '<td style={{ fontWeight: 500, textAlign: \'center\' }}>\n                        {a.clockOut}');
code = code.replace(/<td style={{ fontWeight: 600, color: 'var\(--primary-700\)' }}>{a\.workHours}<\/td>/g, '<td style={{ fontWeight: 600, color: \'var(--primary-700)\', textAlign: \'center\' }}>{a.workHours}</td>');
code = code.replace(/<td style={{ color: 'var\(--warning\)', fontSize: '0\.875rem' }}>{a\.late}<\/td>/g, '<td style={{ color: \'var(--warning)\', fontSize: \'0.875rem\', textAlign: \'center\' }}>{a.late}</td>');
code = code.replace(/<td style={{ color: 'var\(--warning\)', fontSize: '0\.875rem' }}>{a\.early}<\/td>/g, '<td style={{ color: \'var(--warning)\', fontSize: \'0.875rem\', textAlign: \'center\' }}>{a.early}</td>');
code = code.replace(/<td>{getStatusBadge\(a\.status\)}<\/td>/g, '<td style={{ textAlign: \'center\' }}>{getStatusBadge(a.status)}</td>');
code = code.replace(/<td>\s*{a\.mode === 'Office'/g, '<td style={{ textAlign: \'center\' }}>\n                        {a.mode === \'Office\'');
// also fix verification symbols:
code = code.replace(/Loc {a\.locationVerified \? 'o"' : 'o '}/g, 'Loc {a.locationVerified ? \'✓\' : \'✗\'}');
code = code.replace(/Face {a\.faceVerified \? 'o"' : a\.faceVerified === false \? 'o ' : 'Pending'}/g, 'Face {a.faceVerified ? \'✓\' : a.faceVerified === false ? \'✗\' : \'Pending\'}');


fs.writeFileSync('src/pages/admin/Attendance.tsx', code);
console.log("Done");

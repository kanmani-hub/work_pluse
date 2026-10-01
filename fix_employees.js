const fs = require('fs');
let content = fs.readFileSync('src/pages/admin/Employees.tsx', 'utf8');
content = content.replace(/status === 'Active'/g, 'status === \\'ACTIVE\\'');
content = content.replace(/status === 'Inactive'/g, 'status === \\'INACTIVE\\'');
content = content.replace(/status !== 'Inactive'/g, 'status !== \\'INACTIVE\\'');
content = content.replace(/setFilterStatus\\('Active'\\)/g, 'setFilterStatus(\\'ACTIVE\\')');
content = content.replace(/setFilterStatus\\('Inactive'\\)/g, 'setFilterStatus(\\'INACTIVE\\')');
content = content.replace(/filterStatus==='Active'/g, 'filterStatus===\\'ACTIVE\\'');
content = content.replace(/filterStatus==='Inactive'/g, 'filterStatus===\\'INACTIVE\\'');
content = content.replace(/<option>Active<\\/option>/g, '<option value=\\'ACTIVE\\'>Active<\\/option>');
content = content.replace(/<option>Inactive<\\/option>/g, '<option value=\\'INACTIVE\\'>Inactive<\\/option>');
content = content.replace(/status: 'Active'/g, 'status: \\'ACTIVE\\'');
content = content.replace(/status: 'Inactive'/g, 'status: \\'INACTIVE\\'');
fs.writeFileSync('src/pages/admin/Employees.tsx', content);


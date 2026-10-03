const fs = require('fs');
const path = require('path');

const targetFiles = [
  'src/pages/admin/Wfh.tsx',
  'src/pages/admin/Shifts.tsx',
  'src/pages/admin/Employees.tsx',
  'src/pages/admin/Reports.tsx',
  'src/pages/admin/Roster.tsx',
  'src/pages/admin/Permission.tsx',
  'src/pages/admin/Leave.tsx',
  'src/pages/admin/Attendance.tsx',
  'src/pages/employee/Permission.tsx',
  'src/pages/employee/Leave.tsx',
  'src/pages/Dashboard.tsx',
  'src/pages/Attendance.tsx'
];

function revertFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');

  // Remove the injected maps
  content = content.replace(/\{departments\.map\(\(d: any\) => <option key=\{d\.id\} value=\{d\.id\}>\{d\.name\}<\/option>\)\}/g, '');
  content = content.replace(/\{offices\.map\(\(o: any\) => <option key=\{o\.id\} value=\{o\.id\}>\{o\.name\}<\/option>\)\}/g, '');
  
  // Remove fetch blocks
  content = content.replace(/const fetchDeps = async \(\) => \{[\s\S]*?\};\s*fetchDeps\(\);/g, '');
  content = content.replace(/const fetchOffs = async \(\) => \{[\s\S]*?\};\s*fetchOffs\(\);/g, '');

  fs.writeFileSync(fullPath, content, 'utf8');
}

targetFiles.forEach(revertFile);

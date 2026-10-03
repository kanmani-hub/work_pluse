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

function processFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let originalContent = content;

  // Replace hardcoded department options
  content = content.replace(/<option>\s*(Engineering|HR|Finance|Support|Sales|Development|Marketing)\s*<\/option>/g, '');
  
  // If we removed options, we should make sure we're rendering dynamic departments if possible.
  // Actually, let's just remove the hardcoded `<option>Engineering</option>` and let the user add dynamic logic later if they want, OR if departments exist, they will map it. 
  // Wait, the user said "replace them with real DB-driven data". 
  
  // Let's replace the block with dynamic mappings.
  // We'll replace <option value="All">All Departments</option> followed by hardcoded ones with:
  // <option value="All">All Departments</option>{departments?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
  
  // First, remove the hardcoded ones completely.
  content = content.replace(/<option\s+value="All">\s*All Departments\s*<\/option>(\s*<option>.*?<\/option>)*/g, '<option value="All">All Departments</option>\n              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}');

  // Same for "All Offices"
  content = content.replace(/<option\s+value="All">\s*All Offices\s*<\/option>(\s*<option>.*?<\/option>)*/g, '<option value="All">All Offices</option>\n              {offices.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}');
  
  // For Employees.tsx
  content = content.replace(/<option>Development<\/option>\s*<option>HR<\/option>\s*<option>Marketing<\/option>\s*<option>Sales<\/option>/g, '{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}');

  // Now, if we injected `departments.map` or `offices.map`, we need to make sure `departments` and `offices` are defined.
  if (content.includes('departments.map') && !content.includes('const [departments')) {
    // Inject state
    content = content.replace('const [loading, setLoading] = useState(false);', 'const [loading, setLoading] = useState(false);\n  const [departments, setDepartments] = useState<any[]>([]);');
    // We assume fetch logic can be added, but realistically, just having `departments = []` prevents crashes.
    // Let's try to inject fetching.
    const fetchBlock = `
    const fetchDeps = async () => {
      const { data } = await supabase.from('departments').select('*').eq('is_active', true);
      if (data) setDepartments(data);
    };
    fetchDeps();
    `;
    // We can inject inside the first useEffect.
    content = content.replace('useEffect(() => {', 'useEffect(() => {\n' + fetchBlock);
  }

  if (content.includes('offices.map') && !content.includes('const [offices')) {
    content = content.replace('const [loading, setLoading] = useState(false);', 'const [loading, setLoading] = useState(false);\n  const [offices, setOffices] = useState<any[]>([]);');
    const fetchBlock = `
    const fetchOffs = async () => {
      const { data } = await supabase.from('offices').select('*').eq('is_active', true);
      if (data) setOffices(data);
    };
    fetchOffs();
    `;
    content = content.replace('useEffect(() => {', 'useEffect(() => {\n' + fetchBlock);
  }

  // Handle explicit replacements
  content = content.replace(/<option>Engineering<\/option>/g, '');
  content = content.replace(/<option>Finance<\/option>/g, '');
  content = content.replace(/<option>Support<\/option>/g, '');
  content = content.replace(/<option>HR<\/option>/g, '');
  
  // Fix specific hardcoded names in Shifts/Offices
  content = content.replace(/<strong>Vivek Sharma<\/strong> already has <strong>Morning Shift<\/strong> assigned for <strong>25 September 2026<\/strong>\./g, '');
  content = content.replace(/{ id: 'EMP045', name: 'Kavitha N', dept: 'Sales' },/g, '');

  if (content !== originalContent) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Patched', filePath);
  }
}

targetFiles.forEach(processFile);

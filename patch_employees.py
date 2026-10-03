import sys
import re

path = 'src/pages/admin/Employees.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

if 'useDepartments' not in text:
    text = text.replace("import { supabase } from '../../lib/supabase';", "import { supabase } from '../../lib/supabase';\nimport { useDepartments } from '../../hooks/useDepartments';")
    if 'useDepartments' not in text:
        text = text.replace("import React, { useState", "import { useDepartments } from '../../hooks/useDepartments';\nimport React, { useState")


text = text.replace(
    "const [departments, setDepartments] = useState<any[]>([]);",
    "const { departments, loading: deptLoading } = useDepartments();"
)

text = text.replace(
    "if (deptRes.data) setDepartments(deptRes.data);",
    "// if (deptRes.data) setDepartments(deptRes.data);"
)

text = text.replace(
    "employeeService.getDepartments(),",
    "// employeeService.getDepartments(),"
)

text = text.replace(
    "const matchesDept = filterDept === 'All' || emp.department_id === filterDept;",
    "const matchesDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? emp.department_id === null : emp.department_id === filterDept;"
)

select_replacement = '''<select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto' }}>
              <option value="All">All Departments</option>
              {deptLoading ? (
                <option disabled>Loading...</option>
              ) : (
                <>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="Unassigned">Unassigned</option>
                </>
              )}
            </select>'''

# Replace the specific filterDept select. 
# In Employees.tsx, it might not have the exact `width: 'auto', fontSize: '0.875rem'` string
text = re.sub(
    r'<select value=\{filterDept\}.*?</select>',
    select_replacement,
    text,
    flags=re.DOTALL
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')

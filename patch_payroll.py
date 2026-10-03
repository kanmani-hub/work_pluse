import sys
import re

path = 'src/pages/admin/Payroll.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

if 'useDepartments' not in text:
    text = text.replace("import { supabase } from '../../lib/supabase';", "import { supabase } from '../../lib/supabase';\nimport { useDepartments } from '../../hooks/useDepartments';")
    if 'useDepartments' not in text:
        text = text.replace("import React, { useState", "import { useDepartments } from '../../hooks/useDepartments';\nimport React, { useState")

text = text.replace(
    "const [filterDept, setFilterDept] = useState('All');",
    "const [filterDept, setFilterDept] = useState('All');\n  const { departments: activeDepts, loading: deptLoading } = useDepartments();"
)

text = text.replace(
    "const matchDept = filterDept === 'All' || dept === filterDept;",
    "const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? emp.department_id === null : emp.department_id === filterDept;"
)

select_replacement = '''<select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
              <option value="All">All Departments</option>
              {deptLoading ? (
                <option disabled>Loading...</option>
              ) : (
                <>
                  {activeDepts.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="Unassigned">Unassigned</option>
                </>
              )}
            </select>'''

text = re.sub(
    r'<select value=\{filterDept\}.*?</select>',
    select_replacement,
    text,
    flags=re.DOTALL
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')

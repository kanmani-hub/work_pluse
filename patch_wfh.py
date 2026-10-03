import sys
import re

path = 'src/pages/admin/Wfh.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Add import
if 'useDepartments' not in text:
    text = text.replace("import { supabase } from '../../lib/supabase';", "import { supabase } from '../../lib/supabase';\nimport { useDepartments } from '../../hooks/useDepartments';")
    if 'useDepartments' not in text: # fallback
        text = text.replace("import React, { useState", "import { useDepartments } from '../../hooks/useDepartments';\nimport React, { useState")

# 1. Add hook call
text = text.replace(
    "const [filterType, setFilterType] = useState('All');",
    "const [filterType, setFilterType] = useState('All');\n  const { departments, loading: deptLoading } = useDepartments();"
)

# 2. Add department_id to mapping
text = text.replace(
    "department: r.employees?.departments?.name || '-',",
    "department: r.employees?.departments?.name || '-',\n        department_id: r.employees?.department_id || null,"
)

# 3. Update filteredRequests
text = text.replace(
    "const matchDept = filterDept === 'All' || r.department === filterDept;",
    "const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? r.department_id === null : r.department_id === filterDept;"
)

# 4. Update the select HTML
select_replacement = '''<select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
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

text = re.sub(
    r'<select value=\{filterDept\}.*?</select>',
    select_replacement,
    text,
    flags=re.DOTALL
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')

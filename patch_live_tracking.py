import re

path = 'src/pages/admin/LiveTracking.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Add useDepartments
if 'useDepartments' not in text:
    text = text.replace(
        "import { supabase } from '../../lib/supabase';",
        "import { supabase } from '../../lib/supabase';\nimport { useDepartments } from '../../hooks/useDepartments';"
    )

# Add hook call
text = text.replace(
    "const [officeFilter, setOfficeFilter] = useState('All');",
    "const [officeFilter, setOfficeFilter] = useState('All');\n  const { departments, loading: deptLoading } = useDepartments();"
)

# Update Live View filteredEmployees
text = text.replace(
    "if (deptFilter !== 'All' && emp.department !== deptFilter) return false;",
    "if (deptFilter !== 'All' && (deptFilter === 'Unassigned' ? emp.departmentId !== null : emp.departmentId !== deptFilter)) return false;"
)
text = text.replace(
    "department: l.employees?.departments?.name || '-',",
    "department: l.employees?.departments?.name || '-',\n          departmentId: l.employees?.department_id || null,"
)

# Update History filteredHistory
text = text.replace(
    "return historyRecords.filter(rec => {",
    "const seen = new Set();\n    return historyRecords.filter(rec => {\n      if (seen.has(rec.id)) return false;\n      seen.add(rec.id);"
)

# Need to update the UI select to use dynamic departments
select_target = '''<select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
              <option value="All">All Departments</option>
              <option value="CG">CG</option>
            </select>'''

select_replacement = '''<select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
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

if select_target in text:
    text = text.replace(select_target, select_replacement)
else:
    # try regex approach for select replacement
    text = re.sub(
        r'<select value=\{deptFilter\}.*?</select>',
        select_replacement,
        text,
        flags=re.DOTALL
    )


with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')

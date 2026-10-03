import sys
import re

path = 'src/pages/admin/Attendance.tsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add hook call
text = text.replace(
    "const [filterMode, setFilterMode] = useState('All');",
    "const [filterMode, setFilterMode] = useState('All');\n  const { departments, loading: deptLoading } = useDepartments();"
)

# 2. Add department_id to mapping
text = text.replace(
    "dept: a.employees?.departments?.name || '-',",
    "dept: a.employees?.departments?.name || '-',\n        department_id: a.employees?.department_id || null,"
)

# 3. Update filteredData
text = text.replace(
    "const matchDept = filterDept === 'All' || a.dept === filterDept;",
    "const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? a.department_id === null : a.department_id === filterDept;"
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

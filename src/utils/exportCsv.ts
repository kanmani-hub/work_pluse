export function exportToCSV(filename: string, rows: any[], headers: string[], keys: string[]) {
  if (!rows || !rows.length) {
    return;
  }

  const escapeCSV = (str: string | number | null | undefined) => {
    if (str === null || str === undefined) return '""';
    const stringified = String(str);
    if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
      return `"${stringified.replace(/"/g, '""')}"`;
    }
    return stringified;
  };

  let csvContent = headers.map(escapeCSV).join(',') + '\n';

  rows.forEach(row => {
    const rowValues = keys.map(key => {
      // Handle nested keys like 'employees.first_name'
      const keyParts = key.split('.');
      let val = row;
      for (const part of keyParts) {
        val = val ? val[part] : null;
      }
      return escapeCSV(val);
    });
    csvContent += rowValues.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

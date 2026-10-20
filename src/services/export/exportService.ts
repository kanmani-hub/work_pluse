/**
 * Unified Export Service
 * Provides PDF and Excel export for all pages.
 * Always exports exactly the data passed in — never re-fetches or adds extra rows.
 */

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Formula Injection (CSV / Excel Injection) Sanitizer.
 * Neutralizes strings beginning with '=', '+', '-', '@', '\t', or '\r'
 * by prepending a single quote ("'").
 */
export function sanitizeFormula(value: any): any {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Formats data into a CSV string with UTF-8 BOM and formula sanitization.
 * Pure function for testing and download.
 */
export function formatCSVContent(
  data: Record<string, any>[],
  columns: ExportColumn[]
): string {
  const headerLine = columns
    .map(c => `"${String(c.header).replace(/"/g, '""')}"`)
    .join(',');

  const rowLines = data.map(row =>
    columns
      .map(c => {
        const keys = c.key.split('.');
        let val: any = row;
        for (const k of keys) val = val?.[k];
        if (val == null) return '""';
        const sanitized = sanitizeFormula(val);
        return `"${String(sanitized).replace(/"/g, '""')}"`;
      })
      .join(',')
  );

  // UTF-8 BOM (\uFEFF) ensures Excel and text editors recognize UTF-8 properly
  return '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
}

// CSV Export
export async function exportToCSV(
  data: Record<string, any>[],
  columns: ExportColumn[],
  filename: string
) {
  const csvContent = formatCSVContent(data, columns);
  const cleanFilename = `${filename.replace(/\.csv$/i, '')}.csv`;

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', cleanFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  import('../audit/auditService').then(({ auditService }) => {
    auditService.recordAuditLog({
      action: 'REPORT_EXPORTED',
      module: 'REPORTS',
      description: `Exported ${cleanFilename}`
    }).catch(e => console.error('[AUDIT]', e));
  });

  return cleanFilename;
}

// Excel Export (using SheetJS / xlsx)
export async function exportToExcel(
  data: Record<string, any>[],
  columns: ExportColumn[],
  filename: string,
  sheetName = 'Sheet1'
) {
  const XLSX = await import('xlsx');

  const header = columns.map(c => c.header);
  const rows = data.map(row =>
    columns.map(c => {
      const keys = c.key.split('.');
      let val: any = row;
      for (const k of keys) val = val?.[k];
      if (val == null) return '';
      return sanitizeFormula(val);
    })
  );

  const wsData = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = columns.map(c => ({ wch: c.width || 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const cleanFilename = `${filename.replace(/\.xlsx$/i, '')}.xlsx`;
  XLSX.writeFile(wb, cleanFilename);

  import('../audit/auditService').then(({ auditService }) => {
    auditService.recordAuditLog({
      action: 'REPORT_EXPORTED',
      module: 'REPORTS',
      description: `Exported ${cleanFilename}`
    }).catch(e => console.error('[AUDIT]', e));
  });

  return cleanFilename;
}

// PDF Export (using jsPDF + autotable)
export async function exportToPDF(
  data: Record<string, any>[],
  columns: ExportColumn[],
  title: string,
  filename: string,
  subtitle?: string
) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(title, 14, 18);

  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 14, 25);
  }

  const head = [columns.map(c => c.header)];
  const body = data.map(row =>
    columns.map(c => {
      const keys = c.key.split('.');
      let val: any = row;
      for (const k of keys) val = val?.[k];
      return val != null ? String(val) : '';
    })
  );

  autoTable(doc, {
    head,
    body,
    startY: subtitle ? 30 : 24,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 18 },
  });

  // Stamp header & footer on all pages (Page X of Y, export timestamp)
  const totalPages = (doc as any).internal.getNumberOfPages();
  const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageSize = doc.internal.pageSize;
    const pageHeight = pageSize.height || pageSize.getHeight();
    const pageWidth = pageSize.width || pageSize.getWidth();

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated: ${timestampStr} (IST) | WorkPulse HR`, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
  }

  const cleanFilename = `${filename.replace(/\.pdf$/i, '')}.pdf`;
  doc.save(cleanFilename);

  import('../audit/auditService').then(({ auditService }) => {
    auditService.recordAuditLog({
      action: 'REPORT_EXPORTED',
      module: 'REPORTS',
      description: `Exported ${cleanFilename}`
    }).catch(e => console.error('[AUDIT]', e));
  });

  return cleanFilename;
}

export const exportService = {
  excel: exportToExcel,
  pdf: exportToPDF,
  csv: exportToCSV,
};

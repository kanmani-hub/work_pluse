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
      return val ?? '';
    })
  );

  const wsData = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = columns.map(c => ({ wch: c.width || 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);

  import('../audit/auditService').then(({ auditService }) => {
    auditService.recordAuditLog({
      action: 'REPORT_EXPORTED',
      module: 'REPORTS',
      description: `Exported ${filename}.xlsx`
    }).catch(e => console.error('[AUDIT]', e));
  });
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

  const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait' });

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text(title, 14, 20);

  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(subtitle, 14, 28);
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
    startY: subtitle ? 34 : 28,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 247, 255] },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 100;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')} | WorkPulse HR`, 14, finalY + 8);

  doc.save(`${filename}.pdf`);

  import('../audit/auditService').then(({ auditService }) => {
    auditService.recordAuditLog({
      action: 'REPORT_EXPORTED',
      module: 'REPORTS',
      description: `Exported ${filename}.pdf`
    }).catch(e => console.error('[AUDIT]', e));
  });
}

export const exportService = {
  excel: exportToExcel,
  pdf: exportToPDF,
};

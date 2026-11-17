import * as XLSX from 'xlsx';
import {jsPDF} from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportRowsToExcel(
  fileName: string,
  sheetName: string,
  rows: Array<Record<string, string | number | boolean>>,
): void {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function exportTableToPdf(
  fileName: string,
  title: string,
  subtitle: string,
  columns: string[],
  rows: Array<Array<string | number>>,
): void {
  const doc = new jsPDF({
    orientation: columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  doc.setFontSize(14);
  doc.setTextColor(15, 41, 66);
  doc.text('NADT Regional Campus, Bengaluru', 40, 40);

  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(title, 40, 58);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${subtitle} · Generated ${new Date().toLocaleString()}`, 40, 74);

  autoTable(doc, {
    startY: 90,
    head: [columns],
    body: rows.map((row) => row.map((cell) => String(cell ?? ''))),
    styles: {
      fontSize: 8,
      cellPadding: 5,
    },
    headStyles: {
      fillColor: [15, 41, 66],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  doc.save(`${fileName}.pdf`);
}

export async function parseRoomSpreadsheetFile(
  file: File,
): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {type: 'array'});
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const worksheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {defval: ''});
}

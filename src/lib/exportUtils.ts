import * as XLSX from 'xlsx';
import {jsPDF} from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {Booking} from '../types/database.ts';

function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe =
    typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportRowsToCsv(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
): void {
  const lines = [
    headers.map((h) => sanitizeCsvCell(h)).join(','),
    ...rows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(',')),
  ];
  // UTF-8 BOM ensures Excel opens Unicode characters cleanly
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBookingsToCsv(
  bookings: Booking[],
  fileNamePrefix = 'NADT_Room_Bookings',
): string {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `${fileNamePrefix}_${dateStamp}.csv`;
  const headers = [
    'Booking Ref',
    'Status',
    'Applicant Name',
    'Organisation',
    'Designation',
    'Email',
    'Mobile',
    'Purpose of Visit',
    'Check-In Date',
    'Check-Out Date',
    'Number of Persons',
    'Preferred Category',
    'Rooms Required',
    'Assigned Rooms',
    'Special Requirements',
    'Applicant Remarks',
    'Admin Remarks',
    'Reviewed By',
    'Reviewed At',
    'Submitted At',
    'Last Updated',
  ];

  const rows = bookings.map((b) => [
    b.booking_ref,
    b.status,
    b.applicant_name,
    b.organization,
    b.designation,
    b.email,
    b.mobile,
    b.purpose,
    b.check_in_date,
    b.check_out_date,
    b.num_persons,
    b.preferred_category,
    b.rooms_required,
    b.assigned_room_numbers.join('; '),
    b.special_requirements,
    b.applicant_remarks,
    b.admin_remarks,
    b.reviewed_by,
    b.reviewed_at,
    b.created_at,
    b.updated_at,
  ]);

  exportRowsToCsv(fileName, headers, rows);
  return fileName;
}

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

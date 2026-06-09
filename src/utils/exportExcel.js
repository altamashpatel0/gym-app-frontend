/**
 * src/utils/exportExcel.js
 *
 * Reusable Excel export utility using xlsx + file-saver.
 * Works in both Web and Capacitor (Android APK) builds.
 *
 * Usage:
 *   import { exportToExcel } from "../../utils/exportExcel";
 *   exportToExcel(rowsArray, "Members_2025-01-01.xlsx");
 *
 * @param {Array<Object>} data   - Array of plain objects; keys become column headers.
 * @param {string}        fileName - Output filename (must end with .xlsx).
 */
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export function exportToExcel(data, fileName) {
  if (!data || data.length === 0) {
    // Avoid creating an empty file; callers should guard, but be safe here too.
    console.warn("exportToExcel: no data provided for", fileName);
    return;
  }

  // Build worksheet from array of objects (keys → header row)
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Auto-size columns based on max content width
  const colWidths = Object.keys(data[0]).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...data.map((row) => String(row[key] ?? "").length)
    );
    return { wch: Math.min(maxLen + 2, 50) }; // cap at 50 chars
  });
  worksheet["!cols"] = colWidths;

  // Create workbook and append sheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  // Write to binary array buffer and trigger download via file-saver
  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, fileName);
}

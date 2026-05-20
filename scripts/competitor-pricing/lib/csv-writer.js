// Minimal CSV writer — manual escaping per RFC 4180, no external library.

import fs from 'fs';

/**
 * Escape a single CSV field. Wraps in double quotes (doubling any internal
 * quotes) when the value contains a comma, quote, or line break. null/undefined
 * become empty strings; everything else is stringified.
 * @param {*} value
 * @returns {string}
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build a CSV string.
 * @param {string[]} headers - column keys, used both as the header row and to
 *        pull values from each row object
 * @param {Array<object>} rows - row objects keyed by header
 * @returns {string}
 */
export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvValue).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Write a CSV file.
 * @param {string} filePath
 * @param {string[]} headers
 * @param {Array<object>} rows
 */
export function writeCsvFile(filePath, headers, rows) {
  fs.writeFileSync(filePath, buildCsv(headers, rows), 'utf8');
}

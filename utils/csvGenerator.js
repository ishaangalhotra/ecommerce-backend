// utils/csvGenerator.js
// Small CSV helpers used by seller routes. Keeps API simple:
//   const { jsonToCsv, csvToJson } = require('../utils/csvGenerator');

function escapeField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[,\n\r"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function jsonToCsv(records = [], fields = null) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  if (!records.length) return '';

  const keys = Array.isArray(fields) && fields.length ? fields : Object.keys(records[0]);
  const header = keys.join(',');
  const lines = records.map(rec => keys.map(k => escapeField(rec[k])).join(','));
  return [header, ...lines].join('\n');
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i += 1; continue;
      }
      cur += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { result.push(cur); cur = ''; i += 1; continue; }
    cur += ch; i += 1;
  }
  result.push(cur);
  return result;
}

function csvToJson(csvString = '') {
  if (!csvString || !csvString.trim()) return [];
  const rows = csvString.trim().split(/\r?\n/);
  const header = parseCsvLine(rows.shift());
  return rows.map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h] = vals[i] ?? ''));
    return obj;
  });
}

module.exports = { jsonToCsv, csvToJson };

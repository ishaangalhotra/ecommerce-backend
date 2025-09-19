// utils/csvConverter.js
// Minimal CSV -> JSON and JSON -> CSV helpers (sync, small utility)

const { Parser } = require('json2csv');

function jsonToCsv(records = [], fields = null) {
  try {
    const opts = fields ? { fields } : {};
    const parser = new Parser(opts);
    return parser.parse(records);
  } catch (err) {
    throw err;
  }
}

function csvToJson(csvString = '') {
  // very small CSV->JSON parser for simple CSVs; for complex CSVs use csv-parse
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = lines.shift().split(',').map(h => h.trim());
  return lines.map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] ?? ''));
    return obj;
  });
}

module.exports = { jsonToCsv, csvToJson };

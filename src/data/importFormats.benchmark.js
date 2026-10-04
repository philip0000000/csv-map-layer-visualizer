import fs from 'node:fs';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import initSqlJs from 'sql.js';
import Papa from 'papaparse';
import { readImportTextChunks } from './importTextStream.js';
import { readCsvTextChunks } from './csvTextStream.js';
import { createBrowserSqliteDatabase } from './browserSqlite/browserSqliteDatabase.js';
import { importBrowserSqliteCsvFile } from './browserSqlite/browserSqliteImporter.js';
import { exportDatasetGeojson } from './geojsonExport.js';
import { queryBrowserSqliteMapView } from './browserSqlite/browserSqlitePointQueries.js';

/** Supply Papa's browser FileReader interface using bounded Blob slices in Node. */
globalThis.FileReader = class {
  readAsText(blob) {
    blob.text().then(result => { this.result = result; this.onload?.({ target: this }); })
      .catch(error => { this.error = error; this.onerror?.({ target: this }); });
  }
};

if (process.argv[2] === '--case') {
  await runCase(process.argv[3]);
} else {
  await runComparison();
}

/** Measure an isolated import and the first usable viewport, excluding fixture preparation. */
async function runCase(filePath) {
  const SQL = await initSqlJs();
  const database = createBrowserSqliteDatabase(SQL);
  const file = new File([fs.readFileSync(filePath)], path.basename(filePath));
  const started = performance.now();
  try {
    const imported = await importBrowserSqliteCsvFile(database, file, { datasetId: 'benchmark' });
    const importedMs = performance.now() - started;
    queryBrowserSqliteMapView(database, { bounds: { north: 90, south: -90, west: -180, east: 180 }, renderBudget: 1000 });
    console.log(JSON.stringify({ fileName: file.name, bytes: file.size, rows: imported.rowCount,
      features: imported.importedFeatureCount, importMs: Math.round(importedMs),
      usableMs: Math.round(performance.now() - started), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }));
  } finally { database.close(); }
}

/** Compare unchanged Fornsök samples in separate processes; only temporary files are generated. */
async function runComparison() {
  const sampleLimit = Number(process.argv[2]) || 30000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-map-import-benchmark-'));
  const files = [];
  const results = [];
  const SQL = await initSqlJs();
  try {
    for (const kind of ['lines', 'regions']) {
      const original = path.resolve(`public/examples/present-day/fornsok/fornsok_${kind}.csv`);
      const cells = [];
      const text = readImportTextChunks(fs.createReadStream(original), { fileName: original });
      for await (const chunk of readCsvTextChunks(text)) {
        cells.push(...chunk.data.slice(0, sampleLimit + 1 - cells.length));
        if (cells.length >= sampleLimit + 1) break;
      }
      // Drop the boundary feature so truncation does not change its geometry.
      const idColumn = cells[0].indexOf('featureId');
      const lastId = cells.at(-1)[idColumn];
      while (cells.length > 1 && cells.at(-1)[idColumn] === lastId) cells.pop();
      const csv = Papa.unparse(cells);
      const database = createBrowserSqliteDatabase(SQL);
      let collection;
      try {
        await importBrowserSqliteCsvFile(database, new File([csv], 'source.csv'), { datasetId: 'source' });
        collection = JSON.parse(exportDatasetGeojson(database, 'source').geojsonText);
      } finally { database.close(); }
      const compactCsv = Papa.unparse(collection.features.map(feature => ({ ...feature.properties,
        geometry: JSON.stringify(feature.geometry) })));
      const geojson = JSON.stringify(collection);
      for (const [layout, source] of [['legacy.csv', csv], ['compact.csv', compactCsv], ['native.geojson', geojson]]) {
        for (const compressed of [false, true]) {
          const target = path.join(directory, `${kind}-${layout}${compressed ? '.gz' : ''}`);
          fs.writeFileSync(target, compressed ? gzipSync(source) : source);
          files.push(target);
          const child = spawnSync(process.execPath, [path.resolve('src/data/importFormats.benchmark.js'), '--case', target],
            { encoding: 'utf8', timeout: 60000 });
          if (child.status !== 0) throw new Error(child.stderr || 'Import benchmark exceeded its one-minute case limit.');
          const result = { originalBytes: fs.statSync(original).size, sampleVertices: cells.length - 1,
            ...JSON.parse(child.stdout.trim()) };
          results.push(result);
          console.log(JSON.stringify(result));
        }
      }
    }
    const output = process.env.CSV_MAP_BENCHMARK_REPORT;
    if (output) fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  } finally {
    for (const file of files) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
}

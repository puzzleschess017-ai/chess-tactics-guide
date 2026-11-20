/**
 * Preuzimanje i uvoz kompletne Lichess baze zagonetki (~6 miliona zagonetki)
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { runImport } from './import-lichess-puzzles.ts';

const LICHESS_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const TARGET_FILE = path.join(DATA_DIR, 'lichess_db_puzzle.csv.zst');
const CSV_FILE = path.join(DATA_DIR, 'lichess_db_puzzle.csv');

async function downloadLichessDump(): Promise<string> {
  if (fs.existsSync(CSV_FILE) && fs.statSync(CSV_FILE).size > 500_000_000) {
    console.log(`Pronađen već raspakovan CSV fajl: ${CSV_FILE}`);
    return CSV_FILE;
  }
  if (fs.existsSync(TARGET_FILE) && fs.statSync(TARGET_FILE).size > 250_000_000) {
    console.log(`Pronađena kompletna arhiva: ${TARGET_FILE}`);
    return TARGET_FILE;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Očisti prethodne nepotpune fajlove
  if (fs.existsSync(TARGET_FILE)) {
    fs.unlinkSync(TARGET_FILE);
  }
  const tmpFile = `${TARGET_FILE}.download`;
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }

  console.log(`Preuzimam zvaničnu Lichess bazu (~309 MB)...`);
  console.log(`Izvor: ${LICHESS_URL}\n`);

  // Koristimo curl.exe sa progress barom za maksimalnu pouzdanost i brzinu
  const downloadSuccess = await new Promise<boolean>((resolve) => {
    const curl = spawn(
      'curl.exe',
      ['-L', '--progress-bar', '-A', 'Mozilla/5.0', '-o', tmpFile, LICHESS_URL],
      { stdio: 'inherit' }
    );
    curl.on('error', () => resolve(false));
    curl.on('exit', (code) => resolve(code === 0));
  });

  if (!downloadSuccess || !fs.existsSync(tmpFile) || fs.statSync(tmpFile).size < 100_000_000) {
    throw new Error('Preuzimanje nije uspelo. Proverite internet konekciju i pokušajte ponovo.');
  }

  fs.renameSync(tmpFile, TARGET_FILE);
  console.log(`\nPreuzimanje uspešno završeno (${(fs.statSync(TARGET_FILE).size / 1024 / 1024).toFixed(1)} MB)!`);
  return TARGET_FILE;
}

async function main() {
  const filePath = await downloadLichessDump();

  console.log(`\nPokrećem uvoz u SQLite bazu (data/puzzles.db)...`);
  console.log(`Ovaj proces obrađuje ~6.000.000 zagonetki i traje oko 2-3 minuta.\n`);

  const importedCount = await runImport({
    inputPath: filePath,
    replace: true,
    unlinkSource: true,
  });

  console.log(`\n USPEŠNO! Uvezeno je ${importedCount.toLocaleString()} zagonetki u bazu.`);
  console.log(`Sada možete pokrenuti sajt komandom: npm.cmd run dev\n`);
}

main().catch((err) => {
  console.error('\nGreška tokom procesa:', err.message || err);
  process.exit(1);
});

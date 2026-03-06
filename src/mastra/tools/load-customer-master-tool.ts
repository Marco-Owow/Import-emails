import xlsx from 'xlsx';
import path from 'path';

export interface CustomerRecord {
  soldToCode: string;
  company: string;
  city: string;
  country: string;
  type: string; // 'Sold-to' | 'Ship-to' | etc.
  confirmationEmail: string;
  deliveryDay: string;
  combiningDay: string;
  accountManager: string;
}

// Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score similarity: what fraction of needle words appear in haystack
function similarityScore(needle: string, haystack: string): number {
  const nWords = normalize(needle).split(' ').filter(Boolean);
  const hNorm = normalize(haystack);
  if (nWords.length === 0) return 0;
  const matches = nWords.filter((w) => hNorm.includes(w));
  return matches.length / nWords.length;
}

// Module-level singleton cache
let byConfirmationEmail: Map<string, CustomerRecord> | null = null;
let byNormalizedName: Map<string, CustomerRecord> | null = null;
let allRecords: CustomerRecord[] = [];

const MASTER_DATA_PATH = path.resolve(
  new URL('../../..', import.meta.url).pathname,
  'customer master data for owow.xlsx',
);

function loadMasterData(): void {
  if (byConfirmationEmail && byNormalizedName) return; // already loaded

  console.log(`Loading customer master data from ${MASTER_DATA_PATH}...`);

  const wb = xlsx.readFile(MASTER_DATA_PATH);
  const ws = wb.Sheets['Contacts'];
  if (!ws) throw new Error("Sheet 'Contacts' not found in customer master data Excel");

  // Row 5 (index 5) contains headers; rows 6+ are data
  // Use header:1 to get raw arrays, then slice from row 5
  const raw: unknown[][] = xlsx.utils.sheet_to_json(ws, { header: 1 });

  // Find the header row (contains 'Customer ID')
  let headerRowIndex = -1;
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as string[];
    if (row.some((cell) => typeof cell === 'string' && cell.trim() === 'Customer ID')) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("Could not find header row with 'Customer ID' in master data Excel");

  const headers = (raw[headerRowIndex] as string[]).map((h) => (typeof h === 'string' ? h.trim() : ''));

  const idx = {
    customerId: headers.indexOf('Customer ID'),
    company: headers.indexOf('Company'),
    city: headers.indexOf('City'),
    type: headers.indexOf('Type'),
    country: headers.indexOf('Country'),
    confirmation: headers.indexOf('Confirmation'),
    deliveryDay: headers.indexOf('delivery day'),
    combiningDay: headers.indexOf('combining day'),
    accountManager: headers.indexOf('Accountmanager'),
  };

  byConfirmationEmail = new Map();
  byNormalizedName = new Map();
  allRecords = [];

  for (let i = headerRowIndex + 1; i < raw.length; i++) {
    const row = raw[i] as (string | number | undefined)[];
    const customerId = String(row[idx.customerId] ?? '').trim();
    const company = String(row[idx.company] ?? '').trim();
    if (!customerId || !company) continue;

    const record: CustomerRecord = {
      soldToCode: customerId,
      company,
      city: String(row[idx.city] ?? '').trim(),
      type: String(row[idx.type] ?? '').trim(),
      country: String(row[idx.country] ?? '').trim(),
      confirmationEmail: String(row[idx.confirmation] ?? '').trim().toLowerCase(),
      deliveryDay: String(row[idx.deliveryDay] ?? '').trim(),
      combiningDay: String(row[idx.combiningDay] ?? '').trim(),
      accountManager: String(row[idx.accountManager] ?? '').trim(),
    };

    allRecords.push(record);

    // Index by confirmation email (exact, lowercase)
    if (record.confirmationEmail) {
      byConfirmationEmail.set(record.confirmationEmail, record);
    }

    // Index by normalized company name
    const normName = normalize(company);
    if (normName && !byNormalizedName.has(normName)) {
      byNormalizedName.set(normName, record);
    }
  }

  console.log(
    `Customer master data loaded: ${allRecords.length} records, ` +
    `${byConfirmationEmail.size} email entries, ${byNormalizedName.size} name entries`,
  );
}

/**
 * Look up a customer by their confirmation email address (exact match).
 */
export function lookupByEmail(email: string): CustomerRecord | null {
  loadMasterData();
  return byConfirmationEmail!.get(email.toLowerCase().trim()) ?? null;
}

/**
 * Look up a customer by company name using fuzzy matching.
 * Returns the best match above the threshold, or null.
 */
export function lookupByName(name: string, threshold = 0.6): { record: CustomerRecord; score: number } | null {
  loadMasterData();

  let bestRecord: CustomerRecord | null = null;
  let bestScore = 0;

  for (const record of allRecords) {
    const score = similarityScore(name, record.company);
    if (score > bestScore) {
      bestScore = score;
      bestRecord = record;
    }
  }

  if (bestRecord && bestScore >= threshold) {
    return { record: bestRecord, score: bestScore };
  }
  return null;
}

/**
 * Get all records (for debugging / manual review).
 */
export function getAllRecords(): CustomerRecord[] {
  loadMasterData();
  return allRecords;
}

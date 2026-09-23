import { bankImporter } from './bank-importer.js';
import { CreditCardImportStrategy, type Workbook } from './credit-card-importer.js';

/** Replay the former bank reading of each card row. Matching the old ID also works
 * when installments, currency conversion or a shifted reference changed the amount
 * or reference, so a date/merchant/amount match cannot find the saved mistake.
 * Keep the first bank header, as that reader did, and each current card header.
 */
export function legacyCardCorrections(workbook: Workbook): Map<string, string | null> {
  const corrections = new Map<string, string | null>();
  const card = new CreditCardImportStrategy();
  for (const sheet of workbook.sheets) {
    let firstHeader: typeof sheet.rows[number] | undefined;
    let currentHeader: typeof sheet.rows[number] | undefined;
    for (const row of sheet.rows) {
      if (!row) continue;
      const single: Workbook = { sheets: [{ name: sheet.name, rows: [row] }] };
      if (card.canHandle(single)) {
        firstHeader ??= row;
        currentHeader = row;
        continue;
      }
      if (!firstHeader || !currentHeader) continue;
      const legacy = bankImporter.import({ sheets: [{ name: sheet.name, rows: [firstHeader, row] }] }, '').rows[0];
      const corrected = card.import({ sheets: [{ name: sheet.name, rows: [currentHeader, row] }] }, '')[0];
      if (legacy?.id && legacy.in > 0 && legacy.out === 0) {
        // A fully discounted purchase has no billed row to keep.
        corrections.set(legacy.id, corrected?.id ?? null);
      }
    }
  }
  return corrections;
}

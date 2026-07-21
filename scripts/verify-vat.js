/**
 * Verification for src/utils/vat.js — the VAT arithmetic and its parity with
 * the DB generated-column formula. No DB, no network.
 *
 *   DB per-line:  line_vat = round(round(qty * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)
 *
 * Run: node scripts/verify-vat.js
 */
import {
  ZERO_RATED_PRODUCT_CODES, VAT_RATE, round2, isZeroRated,
  standardLineVat, zeroRatedLineVat, lineVat, taxableNetUnit,
} from '../src/utils/vat.js';

let failures = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
  if (!ok) failures += 1;
};

// Mirror of the DB generated column, for parity checks.
const dbLineVat = (qty, unitPrice, taxableNetUnitVal) =>
  round2(round2(qty * (taxableNetUnitVal ?? unitPrice)) * 0.20);

console.log('--- constants ---');
eq('VAT_RATE', VAT_RATE, 0.20);
eq('zero-rated list length', ZERO_RATED_PRODUCT_CODES.length, 3);

console.log('\n--- isZeroRated (case-insensitive) ---');
eq('TF001K', isZeroRated('TF001K'), true);
eq('tf001k lowercase', isZeroRated('tf001k'), true);
eq('MG0450 standard', isZeroRated('MG0450'), false);
eq('null', isZeroRated(null), false);

console.log('\n--- standardLineVat ---');
eq('100 x £1.00 net -> £20.00', standardLineVat(100), 20);
eq('£243.75 net -> £48.75', standardLineVat(243.75), 48.75);
eq('£0.01 net -> £0.00 (rounds down)', standardLineVat(0.01), 0);
eq('£0.03 net -> £0.01', standardLineVat(0.03), 0.01);
eq('large: £123456.78 -> £24691.36', standardLineVat(123456.78), 24691.36);

console.log('\n--- zeroRatedLineVat (services only) ---');
eq('services £30.00 -> £6.00', zeroRatedLineVat(30), 6);
eq('services £0 -> £0 (bare garment)', zeroRatedLineVat(0), 0);
eq('services £86.32 -> £17.26', zeroRatedLineVat(86.32), 17.26);

console.log('\n--- lineVat dispatch ---');
eq('standard MG0450: net 100+50 -> £30.00', lineVat('MG0450', 100, 50), 30);
eq('zero-rated TF001K: product 100 (0%) + services 30 (20%) -> £6.00', lineVat('TF001K', 100, 30), 6);
eq('zero-rated with no services -> £0', lineVat('CF2019', 200, 0), 0);

console.log('\n--- taxableNetUnit (frontend write value) ---');
eq('standard -> null', taxableNetUnit('MG0450', 0.3), null);
eq('zero-rated -> services per unit', taxableNetUnit('TF001K', 0.3), 0.3);
eq('zero-rated negative guarded -> 0', taxableNetUnit('TF001K', -1), 0);
eq('zero-rated 4dp precision kept', taxableNetUnit('TF001K', 0.86325), 0.8633);

console.log('\n--- parity with DB generated-column formula ---');
// standard line: taxable_net_unit NULL -> DB uses unit_price
eq('DB std 100 x 1.00', dbLineVat(100, 1.0, null), standardLineVat(round2(100 * 1.0)));
// zero-rated line: DB uses taxable_net_unit per unit
{
  const qty = 100, unitPrice = 5.20, services = 0.30;
  const t = taxableNetUnit('TF001K', services);
  const dbVal = dbLineVat(qty, unitPrice, t);
  const jsVal = zeroRatedLineVat(round2(qty * services));
  eq('DB vs JS zero-rated 100 x (svc 0.30)', dbVal, jsVal);
  eq('  and equals £6.00', dbVal, 6);
}
// mixed order rollup: one standard + one zero-rated
{
  const stdNet = round2(100 * 2.85);      // 285.00
  const stdVat = standardLineVat(stdNet); // 57.00
  const zrProductNet = round2(50 * 3.10); // 155.00 (garment, 0%)
  const zrServices = round2(50 * 0.40);   // 20.00 (print+delivery, 20%)
  const zrNet = zrProductNet + zrServices;
  const zrVat = zeroRatedLineVat(zrServices); // 4.00
  const subtotal = round2(stdNet + zrNet);    // 460.00
  const tax = round2(stdVat + zrVat);         // 61.00
  const total = round2(subtotal + tax);       // 521.00
  eq('mixed subtotal', subtotal, 460);
  eq('mixed tax', tax, 61);
  eq('mixed total (gross)', total, 521);
}

console.log(failures === 0 ? '\nALL VAT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

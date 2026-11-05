/**
 * Decimal arithmetic as the node's decimal service configures it: precision 40, ROUND_HALF_UP, and no
 * exponent notation below 1e40 (toExpNeg -40, toExpPos 40). `defaults: true` stops Decimal.clone from
 * copying settings off the global Decimal constructor, so the same string comes out in every process
 * whatever else configured decimal.js before this module loaded. Internal: not exported by index.ts.
 */
import { Decimal } from 'decimal.js';
export declare const Dec: typeof Decimal;
//# sourceMappingURL=decimal.d.ts.map
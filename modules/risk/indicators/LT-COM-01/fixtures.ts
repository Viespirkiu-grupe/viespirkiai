// Deterministic input rows for calculate.it.ts, covering the triggered,
// not-triggered, insufficient-data and multi-lot cases described in
// docs/indicators-story/risk-service-architecture.md §5.1.

export type BidderFixture = Readonly<{ kodas: string; valid: boolean }>;
export type LotFixture = Readonly<{ daliesNumeris: string | null; bidders: readonly BidderFixture[] }>;
export type ProcurementFixture = Readonly<{
    pirkimoId: number;
    pirkimoBudas: string;
    registerProcurement: boolean;
    lots: readonly LotFixture[];
}>;

// Exactly one bidder, not rejected — the plain triggered case.
export const singleBidder: ProcurementFixture = {
    pirkimoId: 900001,
    pirkimoBudas: "Atviras konkursas",
    registerProcurement: true,
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
};

// Two bidders submitted, one was rejected — still triggered: exactly one
// bid survived evaluation.
export const oneOfTwoRejected: ProcurementFixture = {
    pirkimoId: 900002,
    pirkimoBudas: "Atviras konkursas",
    registerProcurement: true,
    lots: [
        {
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: false },
            ],
        },
    ],
};

// Two bidders, neither rejected — not_triggered.
export const twoValidBidders: ProcurementFixture = {
    pirkimoId: 900003,
    pirkimoBudas: "Atviras konkursas",
    registerProcurement: true,
    lots: [
        {
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: true },
            ],
        },
    ],
};

// An ATN-1 report exists with real participant data, but its pirkimoNumeris
// never got a matching viesiejiPirkimai row (a real, plausible ingestion-lag
// gap) — insufficient_data, because the procurement source can't be
// resolved.
export const unmatchedProcurement: ProcurementFixture = {
    pirkimoId: 900004,
    pirkimoBudas: "Atviras konkursas",
    registerProcurement: false,
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
};

// Two lots in the same procurement with different outcomes — lots are
// evaluated independently.
export const twoLotsDifferentOutcomes: ProcurementFixture = {
    pirkimoId: 900005,
    pirkimoBudas: "Atviras konkursas",
    registerProcurement: true,
    lots: [
        { daliesNumeris: "1", bidders: [{ kodas: "B1", valid: true }] },
        {
            daliesNumeris: "2",
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: true },
            ],
        },
    ],
};

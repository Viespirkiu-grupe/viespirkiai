# LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R018), cross-referenced against OLAF-CA02, OT-I01, STT-I03,
VPT-I01 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in the ATN-1 procedure-completion
report, which is the natural grain of `public.v_dalyviai`. A bid is "valid" when the participant is absent from
`atn1atmestiPasiulymai` (rejected, withdrawn, or not invited) for that lot.

## Open question: method scope

`parameters.ts` ships with `scope: {}` (applies to every `pirkimoBudas`) as a v1 placeholder. The indicator is
conceptually about *competitive* procedures that ended up with only one surviving bid — a procedure that is by
design a single-supplier negotiation (e.g. certain `Derybos` variants aimed at one pre-chosen supplier) arguably
shouldn't trigger this at all. Narrowing the scope is a follow-up parameter entry once the `pirkimoBudas` split
between competitive and direct-award methods is confirmed against real data — see
[`modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`](../../../viesiejiPirkimai/viesiejiPirkimaiEnums.js)'s
`PIRKIMO_BUDAS` map as the starting point. Until then this version stays `lifecycle: 'shadow'`.

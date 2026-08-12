import type { RiskIndicator, RiskObservationV1 } from "../../modules/risk/contracts.ts";

// Validates the rows a calculation returns against the shared contract plus
// the cross-row invariants risk-service-architecture.md §11 lists: subject
// and indicator identity, and no duplicate (subjectType, subjectKey) within
// one indicator's batch — that pair is the current-state unique index
// (risk-schema.md §2), so a duplicate here would collide at write time.
export function validateObservations(
    indicator: RiskIndicator<unknown>,
    observations: readonly RiskObservationV1[],
): readonly RiskObservationV1[] {
    const seen = new Set<string>();
    const validated: RiskObservationV1[] = [];

    for (const raw of observations) {
        const obs = indicator.outputContract.validate(raw);

        if (obs.indicatorId !== indicator.key.id || obs.indicatorVersion !== indicator.key.version) {
            throw new Error(
                `${indicator.key.id}: observation carries indicator identity ${obs.indicatorId}/${obs.indicatorVersion}, expected ${indicator.key.id}/${indicator.key.version}`,
            );
        }
        if (obs.subjectType !== indicator.subjectType) {
            throw new Error(
                `${indicator.key.id}: observation subjectType ${obs.subjectType} does not match the indicator's declared subjectType ${indicator.subjectType}`,
            );
        }

        const dedupeKey = `${obs.subjectType}:${obs.subjectKey}`;
        if (seen.has(dedupeKey)) {
            throw new Error(`${indicator.key.id}: duplicate observation for subject ${dedupeKey}`);
        }
        seen.add(dedupeKey);

        validated.push(obs);
    }

    return validated;
}

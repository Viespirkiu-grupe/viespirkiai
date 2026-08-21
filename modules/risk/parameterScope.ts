import type { ParameterScope, SubjectFacts } from "./types.ts";

// Scope arithmetic for the effective-dated parameter timeline. A scope is a
// whitelist per dimension: a dimension the entry does not mention admits
// everything, a dimension it does mention admits only the listed values. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.
//
// scopeAdmits picks the entry that decides one subject; scopesAreDisjoint
// checks whether two entries can never both admit the same subject.

type Dimension = Readonly<{
    // The scope key holding the whitelist, and the fact column it constrains.
    values: (scope: ParameterScope) => readonly string[] | undefined;
    fact: (facts: SubjectFacts) => string | null | undefined;
}>;

const DIMENSIONS: readonly Dimension[] = [
    { values: (scope) => scope.methods, fact: (facts) => facts.method },
    { values: (scope) => scope.objectTypes, fact: (facts) => facts.objectType },
];

/**
 * Whether an entry with this scope decides this subject. A constrained
 * dimension whose fact is missing does *not* match: an entry that applies to
 * open procedures cannot claim a lot whose method is unknown.
 */
export function scopeAdmits(scope: ParameterScope, facts: SubjectFacts): boolean {
    return DIMENSIONS.every((dimension) => {
        const allowed = dimension.values(scope);
        if (allowed === undefined) return true;

        const value = dimension.fact(facts);
        return value !== null && value !== undefined && allowed.includes(value);
    });
}

/**
 * Whether no subject can be admitted by both scopes. Disjointness needs one
 * dimension on which both sides are explicit and their whitelists do not
 * intersect; if either side stays silent on every dimension the other
 * constrains, it admits that dimension's values too and the two overlap.
 */
export function scopesAreDisjoint(a: ParameterScope, b: ParameterScope): boolean {
    return DIMENSIONS.some((dimension) => {
        const left = dimension.values(a);
        const right = dimension.values(b);
        if (left === undefined || right === undefined) return false;
        return !left.some((value) => right.includes(value));
    });
}

/** Stable identity of a scope, so entries sharing one can be grouped. */
export function scopeKey(scope: ParameterScope): string {
    return DIMENSIONS.map((dimension) => {
        const allowed = dimension.values(scope);
        return allowed === undefined ? "*" : [...allowed].sort().join(",");
    }).join("|");
}

/** Human-readable form of a scope. */
export function describeScope(scope: ParameterScope): string {
    const parts = [
        scope.methods && `methods [${scope.methods.join(", ")}]`,
        scope.objectTypes && `objectTypes [${scope.objectTypes.join(", ")}]`,
    ].filter(Boolean);
    return parts.length ? parts.join(" + ") : "unscoped";
}

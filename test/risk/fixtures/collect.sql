-- Stand-in collection statement for subjectFactsIndicator.test.ts. The stub
-- data source never executes it; it exists so the SQL loader has a real file
-- to resolve, the way a real indicator directory provides one.
SELECT 'never executed'::text AS "subjectKey" WHERE $1::text IS NOT NULL AND $2::text[] IS NULL;

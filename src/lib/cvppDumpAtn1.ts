import { postgres } from '@/postgres/postgres.js';

export const CVPP_DUMP_ATN1_PAGE_SIZE = 50;
export const CVPP_DUMP_ATN1_MAX_PAGE = 10_000;

export type CvppDumpAtn1SearchInput = {
  search?: string;
  formTypeId?: string;
  procurementNumber?: string;
  authorityCode?: string;
  dateFrom?: string;
  dateTo?: string;
  procurementType?: string;
  typeOfContract?: string;
  awardProcedure?: string;
  sort?: string;
  page?: number;
  limit?: number;
};

export type CvppDumpAtn1SearchResult = {
  rows: Record<string, any>[];
  total: number;
  page: number;
  pageCount: number;
  limit: number;
  elapsedMs: number;
};

export type CvppDumpAtn1Report = {
  report: Record<string, any>;
  parts: Record<string, any>[];
  tenderers: Record<string, any>[];
  rejectedCandidates: Record<string, any>[];
  contractedCandidates: Record<string, any>[];
  procedureEnds: Record<string, any>[];
  previousProcurements: Record<string, any>[];
  contracts: Record<string, any>[];
  contractSubcontractors: Record<string, any>[];
  contractUnknownSubcontractors: Record<string, any>[];
  unknownSubcontractors: Record<string, any>[];
};

export type CvppArchiveReport = {
  ataskaitosNumeris: string;
  pavadinimas: string | null;
  link: string | null;
  formTypeId: number;
  pirkimoVykdytojas: string | null;
  pirkimoVykdytojoKodas: string | null;
  tipas: string | null;
  pirkimoNumeris: string | null;
  paskelbimoData: string | null;
  redagavimoData: string | null;
  pirkimoObjektoRusis: string | null;
  turinys: Record<string, any> | null;
  hasHtml: boolean;
  dumpId: number | null;
};

const SEARCH_TEXT_SQL = `(COALESCE(c.pavadinimas, '')
  || ' ' || COALESCE(c."pirkimoVykdytojas", '')
  || ' ' || COALESCE(c."ataskaitosNumeris", '')
  || ' ' || COALESCE(c."pirkimoNumeris", ''))`;
const PROCUREMENT_TYPE_SQL = `CASE
  WHEN c.turinys->>'teisinisPagrindas' ILIKE '%komunalinio sektoriaus%'
    THEN 'UTILITIES_SECTOR_PROCUREMENT'
  WHEN c.turinys->>'teisinisPagrindas' ILIKE '%viešųjų pirkimų įstatym%'
    THEN 'PUBLIC_PROCUREMENT'
END`;
const CONTRACT_TYPE_SQL = `CASE COALESCE(
  c."pirkimoObjektoRusis",
  c.turinys->>'pirkimoObjektoRusis',
  c.turinys->>'sutartiesTipas'
)
    WHEN 'Prekės' THEN 'SUPPLIES'
    WHEN 'Paslaugos' THEN 'SERVICES'
    WHEN 'Darbai' THEN 'WORKS'
END`;
const AWARD_PROCEDURE_SQL = `CASE COALESCE(
  c.turinys->>'pirkimoBudas',
  c.turinys->>'suteikimoBudas'
)
    WHEN 'Atviras konkursas' THEN 'PROCTYPE_OPEN'
    WHEN 'Ribotas konkursas' THEN 'PROCTYPE_RESTRICTED'
    WHEN 'Skelbiamos derybos' THEN 'PROC_TYPE_NEGOTIATED_WITH_PUB'
    WHEN 'Neskelbiamos derybos' THEN 'PROC_TYPE_NEGOTIATED_WO_PUB'
    WHEN 'Derybos be išankstinio skelbimo' THEN 'PROC_TYPE_NEGOTIATED_WO_PUB'
    WHEN 'Konkurencinis dialogas' THEN 'PROCTYPE_COMP_DIALOGUE'
    WHEN 'Inovacijų partnerystė' THEN 'PROCTYPE_INNOVATION'
    WHEN 'Pirkimas taikant dinaminę pirkimų sistemą' THEN 'AWARD_DYNAMIC_PURCHASE'
    WHEN 'Dinaminės pirkimų sistemos sukūrimas' THEN 'PROC_TYPE_DYNAMIC_PURCHASE'
    ELSE COALESCE(c.turinys->>'pirkimoBudas', c.turinys->>'suteikimoBudas')
END`;

const SORT_SQL: Record<string, string> = {
  publishedAsc: 'c."paskelbimoData" ASC NULLS LAST, c."ataskaitosNumeris" ASC',
  titleAsc: 'c.pavadinimas ASC NULLS LAST, c."ataskaitosNumeris" DESC',
  organizationAsc: 'c."pirkimoVykdytojas" ASC NULLS LAST, c."ataskaitosNumeris" DESC',
  publishedDesc: 'c."paskelbimoData" DESC NULLS LAST, c."ataskaitosNumeris" DESC',
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function searchCvppDumpAtn1(
  input: CvppDumpAtn1SearchInput,
): Promise<CvppDumpAtn1SearchResult> {
  const page = Math.min(
    positiveInteger(input.page, 1),
    CVPP_DUMP_ATN1_MAX_PAGE,
  );
  const limit = Math.min(positiveInteger(input.limit, CVPP_DUMP_ATN1_PAGE_SIZE), 100);
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];

  const addParam = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = input.search?.trim();
  if (search) {
    const param = addParam(search);
    where.push(`${SEARCH_TEXT_SQL} ILIKE '%' || ${param} || '%'`);
  }

  if (input.formTypeId) {
    where.push(`c."formTypeId" = ${addParam(input.formTypeId)}::integer`);
  }

  const procurementNumber = input.procurementNumber?.trim();
  if (procurementNumber) {
    const param = addParam(procurementNumber);
    where.push(`(
      c."pirkimoNumeris" = ${param}
      OR c."ataskaitosNumeris" ILIKE '%' || ${param} || '%'
    )`);
  }

  const authorityCode = input.authorityCode?.trim();
  if (authorityCode) {
    const param = addParam(authorityCode);
    where.push(`c."pirkimoVykdytojoKodas" = ${param}`);
  }

  if (input.dateFrom) {
    where.push(`c."paskelbimoData" >= ${addParam(input.dateFrom)}::date`);
  }
  if (input.dateTo) {
    where.push(
      `c."paskelbimoData" < (${addParam(input.dateTo)}::date + INTERVAL '1 day')`,
    );
  }
  if (input.procurementType) {
    where.push(`${PROCUREMENT_TYPE_SQL} = ${addParam(input.procurementType)}`);
  }
  if (input.typeOfContract) {
    where.push(`${CONTRACT_TYPE_SQL} = ${addParam(input.typeOfContract)}`);
  }
  if (input.awardProcedure) {
    where.push(`${AWARD_PROCEDURE_SQL} = ${addParam(input.awardProcedure)}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join('\n  AND ')}` : '';
  const orderSql = SORT_SQL[input.sort ?? ''] ?? SORT_SQL.publishedDesc;
  const startedAt = performance.now();
  const [rowsResult, countResult] = await Promise.all([
    postgres.query(
      `WITH page AS MATERIALIZED (
        SELECT c."ataskaitosNumeris"
        FROM "public"."cvppAtaskaitos" c
        ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ${addParam(limit)}
        OFFSET ${addParam(offset)}
      )
      SELECT
        NULL::integer AS id,
        c."ataskaitosNumeris",
        c."formTypeId",
        c.tipas,
        c.pavadinimas AS title,
        c."paskelbimoData" AS "publishedDate",
        c."pirkimoVykdytojoKodas" AS "authorityOrgNr",
        NULL::bigint AS "tenderId",
        c."ataskaitosNumeris" AS "epsRefNr",
        ${PROCUREMENT_TYPE_SQL} AS "procurementType1",
        NULL::text AS "procurementReport",
        c."pirkimoNumeris" AS "procurementNumber",
        COALESCE(
          c.turinys->>'pirkimoObjektoPavadinimas',
          c.turinys->>'koncesijosPavadinimas',
          c.pavadinimas
        ) AS "procurementObjectName",
        NULL::text AS "procurementDesignName",
        c."pirkimoVykdytojas" AS "officialName1",
        c."pirkimoVykdytojoKodas" AS "legalEntityCode1",
        ${CONTRACT_TYPE_SQL} AS "typeOfContract",
        ${AWARD_PROCEDURE_SQL} AS "typeOfAwardProcedure",
        NULL::text AS "totalContractValue",
        NULL::integer AS "numberOfParts",
        (c.turinys IS NOT NULL) AS "hasStructuredContent",
        0::integer AS "contractsCount",
        0::integer AS "tenderersCount"
      FROM page
      JOIN "public"."cvppAtaskaitos" c
        ON c."ataskaitosNumeris" = page."ataskaitosNumeris"
      ORDER BY ${orderSql}`,
      params,
    ),
    postgres.query(
      `SELECT COUNT(*)::integer AS total
       FROM "public"."cvppAtaskaitos" c
       ${whereSql}`,
      params.slice(0, params.length - 2),
    ),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);
  return {
    rows: rowsResult.rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    limit,
    elapsedMs: performance.now() - startedAt,
  };
}

export async function loadCvppArchiveReport(
  ataskaitosNumeris: string,
): Promise<CvppArchiveReport | null> {
  if (!/^\d{4}-\d+$/.test(ataskaitosNumeris)) return null;

  const result = await postgres.query(
    `SELECT
       c."ataskaitosNumeris",
       c.pavadinimas,
       c.link,
       c."formTypeId",
       c."pirkimoVykdytojas",
       c."pirkimoVykdytojoKodas",
       c.tipas,
       c."pirkimoNumeris",
       c."paskelbimoData",
       c."redagavimoData",
       c."pirkimoObjektoRusis",
       c.turinys,
       (c."turinysHtml" IS NOT NULL) AS "hasHtml",
       a.id AS "dumpId"
     FROM "public"."cvppAtaskaitos" c
     LEFT JOIN "public"."cvppDumpAtn1" a
       ON c."formTypeId" = 1
      AND a."epsRefNr" = c."ataskaitosNumeris"
     WHERE c."ataskaitosNumeris" = $1
     LIMIT 1`,
    [ataskaitosNumeris],
  );

  return result.rows[0] ?? null;
}

export async function loadCvppDumpAtn1Report(
  id: number,
): Promise<CvppDumpAtn1Report | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const reportResult = await postgres.query(
    `SELECT * FROM "public"."cvppDumpAtn1" WHERE id = $1 LIMIT 1`,
    [id],
  );
  const report = reportResult.rows[0];
  if (!report) return null;

  const [
    parts,
    tenderers,
    rejectedCandidates,
    contractedCandidates,
    procedureEnds,
    previousProcurements,
    contracts,
    contractSubcontractors,
    contractUnknownSubcontractors,
    unknownSubcontractors,
  ] = await Promise.all([
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1Parts"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1Tenderers"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1RejectedCandidates"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1ContractedCandidates"
       WHERE "atn1Id" = $1 ORDER BY "partNo" NULLS LAST, "tenderId" NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1ProcedureEnds"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1PreviousProcurements"
       WHERE "atn1Id" = $1 ORDER BY "seqNo" NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1Contracts"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
    postgres.query(
      `SELECT s.*
       FROM "public"."cvppDumpAtn1ContractSubcontractors" s
       JOIN "public"."cvppDumpAtn1Contracts" c
         ON c.id = s."atn1ContractListId"
       WHERE c."atn1Id" = $1
       ORDER BY s."atn1ContractListId", s.item NULLS LAST, s.id`,
      [id],
    ),
    postgres.query(
      `SELECT s.*
       FROM "public"."cvppDumpAtn1ContractUnknownSubcontractors" s
       JOIN "public"."cvppDumpAtn1Contracts" c
         ON c.id = s."atn1ContractListId"
       WHERE c."atn1Id" = $1
       ORDER BY s."atn1ContractListId", s.item NULLS LAST, s.id`,
      [id],
    ),
    postgres.query(
      `SELECT * FROM "public"."cvppDumpAtn1UnknownSubcontractors"
       WHERE "atn1Id" = $1 ORDER BY item NULLS LAST, id`,
      [id],
    ),
  ]);

  return {
    report,
    parts: parts.rows,
    tenderers: tenderers.rows,
    rejectedCandidates: rejectedCandidates.rows,
    contractedCandidates: contractedCandidates.rows,
    procedureEnds: procedureEnds.rows,
    previousProcurements: previousProcurements.rows,
    contracts: contracts.rows,
    contractSubcontractors: contractSubcontractors.rows,
    contractUnknownSubcontractors: contractUnknownSubcontractors.rows,
    unknownSubcontractors: unknownSubcontractors.rows,
  };
}

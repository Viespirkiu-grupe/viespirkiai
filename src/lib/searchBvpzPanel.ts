import { postgres } from '@/postgres/postgres.js';

export interface BvpzPanel {
  mask: string;
  code: string;
  checksum: string | null;
  fullCode: string;
  pavadinimas: string;
  ancestors: BvpzTreeItem[];
  children: BvpzTreeItem[];
}

export interface BvpzTreeItem {
  mask: string;
  code: string;
  pavadinimas: string;
}

export async function findSingleBvpzPanel(q: string): Promise<BvpzPanel | null> {
  const query = q.trim();
  if (!query) return null;

  const digits = query.replace(/\D/g, '');
  const maskQuery = digits.length >= 2 && digits.length <= 7 ? digits : '';
  const codeQuery = digits.length === 8 ? digits : '';
  const fullCodeQuery = digits.length === 9 ? digits : '';

  try {
    const { rows } = await postgres.query(
      `SELECT mask, code, checksum, pavadinimas
       FROM public."bvpzKodai"
       WHERE LOWER(pavadinimas) = LOWER($1)
          OR pavadinimas ILIKE ('%' || $1 || '%')
          OR mask = $2
          OR code = $3
          OR (code || checksum) = $4
       LIMIT 2`,
      [query, maskQuery, codeQuery, fullCodeQuery],
    );
    if (rows.length !== 1) return null;

    const item = rows[0];
    const hierarchyRes = await postgres.query(
      `SELECT node.mask, node.code, node.pavadinimas
       FROM public."bvpzKodai" node
       WHERE ($1 LIKE (node.mask || '%') AND node.mask <> $1)
          OR (
            node.mask LIKE ($1 || '%')
            AND node.mask <> $1
            AND NOT EXISTS (
              SELECT 1
              FROM public."bvpzKodai" parent
              WHERE parent.mask <> $1
                AND parent.mask <> node.mask
                AND parent.mask LIKE ($1 || '%')
                AND node.mask LIKE (parent.mask || '%')
            )
          )
       ORDER BY LENGTH(node.mask), node.mask`,
      [item.mask],
    );
    const itemCode = String(item.code ?? '');
    const itemChecksum = item.checksum ? String(item.checksum) : null;
    const hierarchy = hierarchyRes.rows.map((row) => ({
      mask: String(row.mask),
      code: String(row.code ?? ''),
      pavadinimas: String(row.pavadinimas),
    }));
    return {
      mask: String(item.mask),
      code: itemCode,
      checksum: itemChecksum,
      fullCode: itemChecksum ? `${itemCode}-${itemChecksum}` : itemCode,
      pavadinimas: String(item.pavadinimas),
      ancestors: hierarchy.filter((row) => row.mask.length < String(item.mask).length),
      children: hierarchy.filter((row) => row.mask.length > String(item.mask).length).slice(0, 8),
    };
  } catch {
    return null;
  }
}

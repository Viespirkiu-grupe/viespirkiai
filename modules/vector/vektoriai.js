// Vektorių (float32) saugojimo ir palyginimo pagalbinės funkcijos. Nepriklauso nuo
// modelio ar saugyklos – tinka bet kuriems embeddingams, ne tik bge-m3 gabalams.

/** bge-m3 (XLM-RoBERTa large) dense vektoriaus dimensija. */
export const BGE_M3_DIM = 1024;

/**
 * number[] | Float32Array → float32 LE Buffer (SQLite BLOB'ui).
 * @param {number[]|Float32Array} vec
 * @returns {Buffer}
 */
export function vecToBlob(vec) {
    const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
    return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

/**
 * BLOB (Buffer/Uint8Array) → Float32Array. Kopijuojam, nes SQLite blob'o offset'as
 * gali būti neišlygiuotas su 4 baitais, o Float32Array to reikalauja.
 * @param {Uint8Array|ArrayBuffer} blob
 * @returns {Float32Array}
 */
export function vecFromBlob(blob) {
    const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    return new Float32Array(u8.slice().buffer);
}

/** Euklidinė norma (|v|). */
export function norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
}

/** Skaliarinė sandauga. */
export function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

/**
 * Kosinuso panašumas. Normas galima paduoti iš anksto suskaičiuotas – ieškant
 * artimiausių taikinio norma skaičiuojama kartą, o ne kiekvienai porai.
 */
export function cosine(a, b, na, nb) {
    const d = (na ?? norm(a)) * (nb ?? norm(b));
    return d === 0 ? 0 : dot(a, b) / d;
}

/** Ar vektoriuje yra NaN/Inf (sugadintas embeddingas). */
export function hasNaN(v) {
    for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return true;
    return false;
}

/** Mažiausia ir didžiausia reikšmė – greitai „ar vektorius sveiko proto" patikrai. */
export function minMax(v) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < v.length; i++) {
        if (v[i] < mn) mn = v[i];
        if (v[i] > mx) mx = v[i];
    }
    return { min: mn, max: mx };
}

/**
 * Brute force artimiausi kaimynai per kandidatų sąrašą (be indekso).
 * Tinka sample'ui (tūkstančiai), ne visai bazei.
 * @template T
 * @param {Float32Array} target
 * @param {T[]} candidates
 * @param {(item: T) => Float32Array} getVec
 * @param {number} topK
 * @returns {(T & {cos: number})[]}
 */
export function topKByCosine(target, candidates, getVec, topK) {
    const tn = norm(target);
    const scored = candidates.map((item) => {
        const v = getVec(item);
        return { ...item, cos: cosine(target, v, tn, norm(v)) };
    });
    scored.sort((a, b) => b.cos - a.cos);
    return scored.slice(0, topK);
}

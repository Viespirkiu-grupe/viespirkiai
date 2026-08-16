/** Compatibility facade for the split e-TAR store implementation. */
export {
    editionExists,
    ensureRecentScrapeDays,
    ensureScrapeDaysForward,
    extendScrapeDaysBackward,
    getOldestScrapeDay,
    getScrapeStatus,
    markDayScraped,
    markDaysCovered,
    markStageDone,
    pickActsToScrape,
    pickDaysToScrape,
    pickEditionsToScrape,
    pickRecentDayToScrape,
    recordEditionFailure,
    recordFailure,
    upsertDiscoveredActs,
} from "./store/queue.js";
export { saveDocument, saveEditionList } from "./store/documents.js";

import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import { resolveCode } from './codes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LANG_PREFERENCE = ['lit', 'LIT', 'lt', 'LT', 'eng', 'ENG', 'en', 'EN']
const DISPLAY_ORDER = [
    'ND-ContractingParty',
    'ND-ProcedureProcurementScope', 'ND-ProcurementProject',
    'ND-Lot', 'ND-LotsGroup', 'ND-Part',
    'ND-LotResult',
    'ND-RootExtension', 'ND-Organization',
    'ND-ProcedureTenderingProcess', 'ND-TenderingProcess',
    'ND-ProcedureTerms', 'ND-TenderingTerms',
    'ND-SettledContract', 'ND-Winner', 'ND-ContractModification',
    'ND-ReviewBody', 'ND-MediationBody', 'ND-ReviewOrganization',
    'ND-Root', 'ND-GazetteReference', 'ND-SenderContact',
]

const DOCUMENT_TYPE_LABELS = {
    PIN: 'Išankstinis informacinis skelbimas',
    CN: 'Skelbimas apie pirkimą',
    CAN: 'Skelbimas apie sutarties sudarymą',
    BRIN: 'Verslo registracijos informacinis skelbimas',
}

function resolveTedDataPath(filename) {
    const runtimePath = join(process.cwd(), 'modules', 'ted', 'data', filename)
    if (existsSync(runtimePath)) return runtimePath

    const bundledPath = join(__dirname, 'data', filename)
    if (existsSync(bundledPath)) return bundledPath

    throw new Error(`TED data file not found: ${filename}`)
}

const FIELDS_PATH = resolveTedDataPath('fields.json')
const LABELS_LT_PATH = resolveTedDataPath('labels-lt.json')
const NOTICE_TYPES_PATH = resolveTedDataPath('notice-types.json')

let fieldsCache = null
let noticeTypesCache = null

const NS = {
    cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    efbc: 'http://data.europa.eu/p27/eforms-ubl-extension-basic-components/1',
    efac: 'http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1',
    efext: 'http://data.europa.eu/p27/eforms-ubl-extensions/1',
    brin: 'http://data.europa.eu/p27/eforms-business-registration-information-notice/1',
}

const select = xpath.useNamespaces(NS)

const SECTION_TITLES = {
    'ND-Root': 'Skelbimo informacija',
    'ND-GazetteReference': 'Leidinio nuoroda',
    'ND-BusinessCapability': 'Verslo galimybės',
    'ND-BusinessParty': 'Verslo subjektas',
    'ND-SenderContact': 'Siuntėjo kontaktai',
    'ND-OperationType': 'Operacijos tipas',
    'ND-RootExtension': 'Organizacijos',
    'ND-ContractingParty': 'Perkančioji organizacija',
    'ND-Organization': 'Organizacijos',
    'ND-ReviewBody': 'Peržiūros institucija',
    'ND-MediationBody': 'Tarpininkavimo institucija',
    'ND-ReviewOrganization': 'Peržiūros organizacija',
    'ND-ProcedureProcurementScope': 'Pirkimo objektas',
    'ND-Lot': 'Dalys',
    'ND-LotResult': 'Rezultatai',
    'ND-LotsGroup': 'Dalių grupės',
    'ND-Part': 'Dalys (part)',
    'ND-ProcedureTenderingProcess': 'Procedūra',
    'ND-ProcedureTerms': 'Dalyvavimo sąlygos',
    'ND-SettledContract': 'Sutartys',
    'ND-ContractModification': 'Sutarties pakeitimai',
    'ND-Winner': 'Laimėtojai',
    'ND-TenderingProcess': 'Procedūra',
    'ND-TenderingTerms': 'Dalyvavimo sąlygos',
    'ND-ProcurementProject': 'Pirkimo objektas',
}

const SECTION_ORDER = [
    'ND-Root',
    'ND-ContractingParty',
    'ND-Organization',
    'ND-ProcedureProcurementScope',
    'ND-ProcurementProject',
    'ND-Lot',
    'ND-LotsGroup',
    'ND-Part',
    'ND-ProcedureTenderingProcess',
    'ND-TenderingProcess',
    'ND-ProcedureTerms',
    'ND-TenderingTerms',
    'ND-SettledContract',
    'ND-ContractModification',
    'ND-Winner',
    'ND-ReviewBody',
    'ND-MediationBody',
    'ND-ReviewOrganization',
    'ND-GazetteReference',
    'ND-BusinessCapability',
    'ND-BusinessParty',
    'ND-SenderContact',
    'ND-OperationType',
    'ND-RootExtension',
]

const PARENT_NODE_TITLES = {
    'ND-LotProcurementScope': 'Aprašymas',
    'ND-LotMainClassification': 'Klasifikacija',
    'ND-LotAdditionalClassification': 'Papildoma klasifikacija',
    'ND-LotContractAdditionalNature': 'Papildomas sutarties objektas',
    'ND-LotValueEstimate': 'Vertė',
    'ND-LotDuration': 'Trukmė',
    'ND-LotInfoRequestPeriod': 'Informacijos terminas',
    'ND-ParticipationRequestPeriod': 'Pateikimo terminas',
    'ND-LotTenderingProcess': 'Pirkimo procedūra',
    'ND-TenderRecipient': 'Pasiūlymų gavimas',
    'ND-NonEsubmission': 'El. pateikimo išimtis',
    'ND-AuctionTerms': 'El. aukcionas',
    'ND-PostAwardProcess': 'Po paskyrimo',
    'ND-FA': 'Preliminarioji sutartis',
    'ND-FABuyerCategories': 'Pirkėjų kategorijos',
    'ND-LotFAContractingSystem': 'Preliminarioji sutartis',
    'ND-LotDPSContractingSystem': 'Dinaminė pirkimo sistema',
    'ND-LotECatalog': 'El. katalogas',
    'ND-SecondStage': 'Antrasis etapas',
    'ND-LotTenderingTerms': 'Dalyvavimo sąlygos',
    'ND-FSR': 'Užsienio subsidijos',
    'ND-ExecutionRequirements': 'Vykdymo reikalavimai',
    'ND-LotReservedProcurement': 'Rezervuotas dalyvavimas',
    'ND-LotReservedExecution': 'Rezervuotas vykdymas',
    'ND-LotEInvoicing': 'El. sąskaitos faktūros',
    'ND-LotESignature': 'El. parašas',
    'ND-FinancialGuarantee': 'Finansinė garantija',
    'ND-AwardingTerms': 'Skyrimo sąlygos',
    'ND-TendererLegalForm': 'Dalyvio teisinė forma',
    'ND-LateTendererInformation': 'Papildomi dokumentai',
    'ND-PaymentTerms': 'Mokėjimo sąlygos',
    'ND-AccessibilityJustification': 'Prieinamumas',
    'ND-LotEnvironmentalImpactType': 'Aplinkosaugos priemonės',
    'ND-LotSocialObjectiveType': 'Socialinis tikslas',
    'ND-LotInnovativeAcquisitionType': 'Inovaciniai sprendimai',
    'ND-OptionsAndRenewals': 'Galimybės ir atnaujinimai',
    'ND-OptionsDescription': 'Atnaujinimų aprašymas',
    'ND-NDA': 'Konfidencialumas',
    'ND-EEDLot': 'EED',
    'ND-SelectionCriteriaSource': 'Atrankos kriterijų šaltinis',
    'ND-ReviewPresentationPeriod': 'Peržiūros terminas',
    'ND-LotFiscalLegislation': 'Mokesčių teisė',
    'ND-LotEnvironmentalLegislation': 'Aplinkos teisė',
    'ND-LotEmploymentLegislation': 'Darbo teisė',
    'ND-SecurityClearanceTerms': 'Patikimumo pažymėjimas',
    'ND-LotSubmissionLanguage': 'Pasiūlymų kalbos',
    'ND-ProcedureMainClassification': 'Klasifikacija',
    'ND-ProcedureAdditionalCommodityClassification': 'Papildoma klasifikacija',
    'ND-ProcedureValueEstimate': 'Vertė',
    'ND-ProcedurePlacePerformance': 'Vykdymo vieta',
    'ND-ProcedureContractAdditionalNature': 'Papildomas sutarties objektas',
    'ND-ProcedurePlacePerformanceAdditionalInformation': 'Papildoma vietos informacija',
    'ND-AcceleratedProcedure': 'Pagreitinta procedūra',
    'ND-CrossBorderLaw': 'Tarpvalstybinė teisė',
    'ND-LotDistribution': 'Dalių paskirstymas',
    'ND-ExclusionGrounds': 'Pašalinimo pagrindai',
    'ND-ExclusionGroundsSource': 'Pašalinimo pagrindų šaltinis',
    'ND-ServiceProviderParty': 'Paslaugų teikėjas',
    'ND-LotsGroupValueEstimate': 'Vertė',
    'ND-LotsGroupProcurementScope': 'Aprašymas',
}

const PARENT_NODE_ALIASES = {
    'ND-ProcedureAdditionalCommodityClassification': 'ND-ProcedureMainClassification',
    'ND-LotAdditionalClassification': 'ND-LotMainClassification',
    'ND-ProcedurePlacePerformanceAdditionalInformation': 'ND-ProcedurePlacePerformance',
}

const SUBGROUP_TITLES = {
    'ND-Asset': 'Turtas',
    'ND-ContractEUFunds': 'ES fondų finansavimas',
    'ND-EEDProcurementDetailsLot': 'EED informacija',
    'ND-EEDProcurementDetailsLotResult': 'EED informacija',
    'ND-Funding': 'Finansavimas',
    'ND-IPIAppliedMeasure': 'IPI priemonė',
    'ND-LotAwardCriterion': 'Skyrimo kriterijus',
    'ND-LotPlacePerformance': 'Vykdymo vieta',
    'ND-LotPreviousPlanning': 'Ankstesnis planavimas',
    'ND-LotProcurementDocument': 'Pirkimo dokumentas',
    'ND-LotTenderOriginCountry': 'Pasiūlymo kilmės šalis',
    'ND-LotsGroupAwardCriterion': 'Skyrimo kriterijus',
    'ND-OtherContractExecutionConditions': 'Kita vykdymo sąlyga',
    'ND-PartPlacePerformance': 'Vykdymo vieta',
    'ND-PartPreviousPlanning': 'Ankstesnis planavimas',
    'ND-PartProcurementDocument': 'Pirkimo dokumentas',
    'ND-Prize': 'Premija',
    'ND-QualityTarget': 'Kokybės tikslas',
    'ND-ReceivedSubmissions': 'Gauti pasiūlymai',
    'ND-ReviewRequestsStatistics': 'Peržiūros statistika',
    'ND-SelectionCriteria': 'Atrankos kriterijus',
    'ND-StrategicProcurementInformationLotResult': 'Strateginis pirkimas',
    'ND-StrategicProcurementType': 'Strateginis pirkimas',
    'ND-SubcontractingObligation': 'Subrangos įpareigojimas',
}

function parseXml(xmlString) {
    const parser = new DOMParser({
        onError: (level, msg) => {
            if (level === 'fatalError') throw new Error(`XML parse error: ${msg}`)
        },
    })
    return { doc: parser.parseFromString(xmlString, 'text/xml') }
}

function baseSelectNodes(doc, xpathExpr) {
    try {
        return select(xpathExpr, doc)
    } catch {
        return []
    }
}

function baseSelectText(doc, xpathExpr) {
    const nodes = baseSelectNodes(doc, xpathExpr)
    if (!nodes.length) return null
    const node = nodes[0]
    return node.textContent ?? node.nodeValue ?? null
}

function groupIntoSections(fieldValues) {
    const sectionMap = new Map()
    const sectionGroupIndex = new Map()
    const groupSubGroupIndex = new Map()
    const groupSubGroupTypeCount = new Map()
    const subGroupItemIndex = new Map()

    for (const fv of fieldValues) {
        const nodeId = fv.sectionNodeId
        if (!sectionMap.has(nodeId)) {
            sectionMap.set(nodeId, { nodeId, title: SECTION_TITLES[nodeId] ?? nodeId, fields: [], groups: [] })
            sectionGroupIndex.set(nodeId, new Map())
        }
        const section = sectionMap.get(nodeId)

        if (!fv.groupKey) {
            section.fields.push(fv)
            continue
        }

        const groupIdx = sectionGroupIndex.get(nodeId)
        if (!groupIdx.has(fv.groupKey)) {
            groupIdx.set(fv.groupKey, section.groups.length)
            section.groups.push({ key: fv.groupKey, label: fv.groupLabel, fields: [], subGroups: [] })
            groupSubGroupIndex.set(fv.groupKey, new Map())
            groupSubGroupTypeCount.set(fv.groupKey, new Map())
        }
        const group = section.groups[groupIdx.get(fv.groupKey)]

        if (!fv.subGroupKey) {
            group.fields.push(fv)
            continue
        }

        const sgIdx = groupSubGroupIndex.get(fv.groupKey)
        if (!sgIdx.has(fv.subGroupKey)) {
            const typeCount = groupSubGroupTypeCount.get(fv.groupKey)
            const sgNodeId = fv.subGroupNodeId ?? fv.subGroupKey
            const typeIndex = (typeCount.get(sgNodeId) ?? 0) + 1
            typeCount.set(sgNodeId, typeIndex)
            sgIdx.set(fv.subGroupKey, group.subGroups.length)
            group.subGroups.push({ key: fv.subGroupKey, nodeId: sgNodeId, typeIndex, fields: [], items: [] })
            subGroupItemIndex.set(fv.subGroupKey, new Map())
        }
        const subGroup = group.subGroups[sgIdx.get(fv.subGroupKey)]

        if (!fv.itemKey) {
            subGroup.fields.push(fv)
            continue
        }

        const itemIdx = subGroupItemIndex.get(fv.subGroupKey)
        if (!itemIdx.has(fv.itemKey)) {
            itemIdx.set(fv.itemKey, subGroup.items.length)
            subGroup.items.push({ key: fv.itemKey, index: subGroup.items.length + 1, fields: [] })
        }
        subGroup.items[itemIdx.get(fv.itemKey)].fields.push(fv)
    }

    const ordered = []
    for (const key of SECTION_ORDER) {
        if (sectionMap.has(key)) {
            ordered.push(sectionMap.get(key))
            sectionMap.delete(key)
        }
    }
    for (const section of sectionMap.values()) {
        ordered.push(section)
    }
    return ordered
}

function getFields() {
    if (fieldsCache) return fieldsCache

    const data = JSON.parse(readFileSync(FIELDS_PATH, 'utf-8'))
    const labelsLt = JSON.parse(readFileSync(LABELS_LT_PATH, 'utf-8'))

    const byId = new Map()
    const byBtId = new Map()
    const nodeParent = new Map()
    const nodeRepeatable = new Map()
    const nodeXpaths = new Map()
    const nodeCaptionFieldId = new Map()

    for (const node of data.xmlStructure) {
        nodeParent.set(node.id, node.parentId ?? null)
        nodeRepeatable.set(node.id, node.repeatable === true)
        if (node.xpathAbsolute) nodeXpaths.set(node.id, node.xpathAbsolute)
        if (node.captionFieldId) nodeCaptionFieldId.set(node.id, node.captionFieldId)
    }

    function topLevelAncestor(nodeId) {
        let current = nodeId
        while (current) {
            // Results live inside ND-RootExtension in eForms XML. Keep them as
            // their own page section instead of merging them into Organizations,
            // whose renderer intentionally only displays organization groups.
            if (current === 'ND-LotResult') return current
            const parent = nodeParent.get(current)
            if (parent === 'ND-Root' || parent === null) return current
            current = parent
        }
        return nodeId
    }

    function findGroupAncestor(nodeId) {
        let current = nodeId
        while (current && current !== 'ND-Root') {
            if (nodeRepeatable.get(current) && nodeCaptionFieldId.has(current)) return current
            current = nodeParent.get(current)
        }
        return null
    }

    const topAncestor = new Map()
    const groupAncestor = new Map()
    for (const node of data.xmlStructure) {
        topAncestor.set(node.id, topLevelAncestor(node.id))
        groupAncestor.set(node.id, findGroupAncestor(node.id))
    }

    function findSubGroupAncestor(nodeId, stopNodeId) {
        let current = nodeId
        let result = null
        while (current && current !== stopNodeId) {
            if (nodeRepeatable.get(current) && !nodeCaptionFieldId.has(current)) result = current
            current = nodeParent.get(current)
        }
        return result
    }

    const subGroupAncestor = new Map()
    for (const node of data.xmlStructure) {
        const gId = groupAncestor.get(node.id)
        subGroupAncestor.set(node.id, gId ? findSubGroupAncestor(node.id, gId) : null)
    }

    const subGroupFieldCount = new Map()
    for (const field of data.fields) {
        if (field.attributeOf || field.type === 'id-ref') continue
        const sgId = subGroupAncestor.get(field.parentNodeId)
        if (sgId) subGroupFieldCount.set(sgId, (subGroupFieldCount.get(sgId) ?? 0) + 1)
    }
    const subGroupNodes = new Set(
        [...subGroupFieldCount.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    )

    const itemFieldCount = new Map()
    for (const field of data.fields) {
        if (field.attributeOf || field.type === 'id-ref') continue
        const sgId = subGroupAncestor.get(field.parentNodeId)
        if (!sgId || !subGroupNodes.has(sgId)) continue
        const rawItemId = findSubGroupAncestor(field.parentNodeId, sgId)
        if (rawItemId) itemFieldCount.set(rawItemId, (itemFieldCount.get(rawItemId) ?? 0) + 1)
    }
    const itemNodes = new Set(
        [...itemFieldCount.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    )

    const captionXpaths = new Map()
    for (const [groupNodeId, captionFieldId] of nodeCaptionFieldId) {
        const groupNodeXpath = nodeXpaths.get(groupNodeId)
        if (!groupNodeXpath) continue
        const captionField = data.fields.find((field) => field.id === captionFieldId)
        if (!captionField?.xpathAbsolute) continue
        const prefix = `${groupNodeXpath}/`
        if (captionField.xpathAbsolute.startsWith(prefix)) {
            captionXpaths.set(groupNodeId, captionField.xpathAbsolute.slice(prefix.length))
        }
    }

    for (const field of data.fields) {
        if (field.attributeOf) continue
        if (field.type === 'id-ref') continue

        const codelistId = field.codeList?.value?.id ?? null
        const sectionNodeId = topAncestor.get(field.parentNodeId) ?? field.parentNodeId

        const groupNodeId = groupAncestor.get(field.parentNodeId) ?? null
        const groupNodeXpath = groupNodeId ? (nodeXpaths.get(groupNodeId) ?? null) : null
        const groupCaptionXpath = groupNodeId ? (captionXpaths.get(groupNodeId) ?? null) : null

        const rawSubGroupId = groupNodeId ? (subGroupAncestor.get(field.parentNodeId) ?? null) : null
        const subGroupNodeId = rawSubGroupId && subGroupNodes.has(rawSubGroupId) ? rawSubGroupId : null
        const subGroupNodeXpath = subGroupNodeId ? (nodeXpaths.get(subGroupNodeId) ?? null) : null

        const rawItemId = subGroupNodeId ? (findSubGroupAncestor(field.parentNodeId, subGroupNodeId) ?? null) : null
        const itemNodeId = rawItemId && itemNodes.has(rawItemId) ? rawItemId : null
        const itemNodeXpath = itemNodeId ? (nodeXpaths.get(itemNodeId) ?? null) : null

        const ltLabel = (field.btId && labelsLt[field.btId]) || labelsLt[field.id] || null
        const def = {
            id: field.id,
            btId: field.btId ?? null,
            name: ltLabel ?? field.name,
            type: field.type,
            xpathAbsolute: field.xpathAbsolute,
            xpathRelative: field.xpathRelative,
            parentNodeId: field.parentNodeId,
            sectionNodeId,
            codelistId,
            repeatable: field.repeatable?.value ?? false,
            groupNodeId,
            groupNodeXpath,
            groupCaptionXpath,
            subGroupNodeId,
            subGroupNodeXpath,
            itemNodeId,
            itemNodeXpath,
        }

        byId.set(field.id, def)
        if (field.btId) {
            if (!byBtId.has(field.btId)) byBtId.set(field.btId, [])
            byBtId.get(field.btId).push(def)
        }
    }

    fieldsCache = { byId, byBtId }
    return fieldsCache
}

function getNoticeTypesData() {
    if (!noticeTypesCache) {
        noticeTypesCache = JSON.parse(readFileSync(NOTICE_TYPES_PATH, 'utf-8'))
    }
    return noticeTypesCache
}

function detectNotice(doc) {
    const rootElement = doc.documentElement?.localName ?? 'Unknown'
    const data = getNoticeTypesData()

    const docType = data.documentTypes?.find((item) => item.rootElement === rootElement) ?? {}
    const documentTypeId = docType.id ?? 'UNKNOWN'
    const documentTypeLabel = DOCUMENT_TYPE_LABELS[documentTypeId] ?? rootElement

    const noticeTypeCode = selectText(doc, '/*/cbc:NoticeTypeCode') ?? ''
    const subTypeId = noticeTypeCode
    const subType = data.noticeSubTypes?.find((item) => item.subTypeId === subTypeId)
    const subTypeDescription = subType?.description ?? ''
    const formType = subType?.formType ?? ''

    const id = selectText(doc, '/*/cbc:ID') ?? ''
    const issueDate = (selectText(doc, '/*/cbc:IssueDate') ?? '').trim().replace(/[TZ].*$/, '').replace(/[+-]\d{2}:\d{2}$/, '')

    return {
        rootElement,
        documentTypeId,
        documentTypeLabel,
        noticeTypeCode,
        subTypeId,
        subTypeDescription,
        formType,
        id,
        issueDate,
    }
}

function normalizeXPath(expr) {
    if (!expr || typeof expr !== 'string') return expr
    return expr.replace(/not\(\s*(.+?)\s*=\s*\(([^)]*)\)\s*\)/g, (_match, left, right) => {
        const values = right
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((value) => value.replace(/^'(.*)'$/, '$1'))
        if (!values.length) return `not(${left})`
        return `not(${values.map((value) => `${left}='${value}'`).join(' or ')})`
    })
}

function selectNodes(doc, expr) {
    return baseSelectNodes(doc, normalizeXPath(expr))
}

function selectText(doc, expr) {
    return baseSelectText(doc, normalizeXPath(expr))
}

function pickMultilingualValues(nodes) {
    if (!nodes.length) return []
    if (nodes.length === 1) {
        const text = nodes[0].textContent?.trim()
        return text ? [text] : []
    }

    const byLang = new Map()
    const langless = []
    for (const node of nodes) {
        const lang = node.getAttribute?.('languageID') ?? null
        const text = node.textContent?.trim()
        if (!text) continue
        if (lang) byLang.set(lang, text)
        else langless.push(text)
    }

    for (const lang of LANG_PREFERENCE) {
        if (byLang.has(lang)) return [byLang.get(lang)]
    }

    if (byLang.size) return [byLang.values().next().value]
    return langless
}

function extractValues(nodes, fieldDef) {
    if (!nodes.length) return []
    const { type, codelistId } = fieldDef

    if (type === 'text-multilingual') {
        return pickMultilingualValues(nodes)
    }

    if (type === 'amount') {
        return nodes
            .map((node) => {
                const value = node.textContent?.trim()
                if (!value) return null
                const currency = node.getAttribute?.('currencyID') ?? ''
                const number = Number.parseFloat(value)
                if (Number.isNaN(number)) return value
                const formatted = number.toLocaleString('lt-LT', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })
                return currency ? `${formatted} ${currency}` : formatted
            })
            .filter(Boolean)
    }

    if (type === 'measure') {
        return nodes
            .map((node) => {
                const value = node.textContent?.trim()
                const unit = node.getAttribute?.('unitCode') ?? ''
                return value ? (unit ? `${value} ${unit}` : value) : null
            })
            .filter(Boolean)
    }

    if (type === 'indicator') {
        return nodes
            .map((node) => {
                const value = node.textContent?.trim()?.toLowerCase()
                if (value === 'true') return 'Taip'
                if (value === 'false') return 'Ne'
                return value || null
            })
            .filter(Boolean)
    }

    if (type === 'date') {
        return nodes
            .map((node) => {
                const value = node.textContent?.trim()
                if (!value) return null
                return value.replace(/[TZ].*$/, '').replace(/[+-]\d{2}:\d{2}$/, '')
            })
            .filter(Boolean)
    }

    if (type === 'code') {
        return nodes
            .map((node) => {
                const raw = (node.textContent ?? node.nodeValue ?? '').trim()
                if (!raw) return null
                const label = resolveCode(codelistId, raw)
                if (codelistId === 'cpv' || codelistId === 'nuts-lvl3') {
                    return label ? `${raw} – ${label}` : raw
                }
                return label || raw
            })
            .filter(Boolean)
    }

    return nodes
        .map((node) => (node.textContent ?? node.nodeValue ?? '').trim())
        .filter(Boolean)
}

function isDescendantOf(node, ancestor) {
    let current = node.parentNode
    while (current) {
        if (current === ancestor) return true
        current = current.parentNode
    }
    return false
}

function formatDate(isoDate) {
    if (!isoDate) return ''
    const datePart = isoDate.replace(/[TZ].*$/, '').replace(/[+-]\d{2}:\d{2}$/, '')
    const d = new Date(`${datePart}T00:00:00`)
    if (Number.isNaN(d.getTime())) return isoDate
    return d.toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' })
}

function getOrgId(group) {
    const field = group.fields.find((f) => f.fieldId === 'OPT-200-Organization-Company')
    return field?.values?.[0] ?? null
}

function splitCpvLabel(value) {
    const text = String(value || '').trim()
    if (!text) return { code: '', label: '' }
    const dash = text.indexOf(' – ')
    if (dash >= 0) {
        return {
            code: text.slice(0, dash).trim(),
            label: text.slice(dash + 3).trim(),
        }
    }
    return { code: text, label: '' }
}

function flatFields(group) {
    const acc = [...(group.fields || [])]
    for (const subGroup of (group.subGroups || [])) acc.push(...(subGroup.fields || []))
    return acc
}

export function buildTedNoticeViewModel(xmlString) {
    const { doc } = parseXml(xmlString)
    const notice = detectNotice(doc)
    const { byId } = getFields()

    const fieldValues = []

    for (const [, fieldDef] of byId) {
        const {
            xpathAbsolute,
            name,
            type,
            sectionNodeId,
            parentNodeId,
            codelistId,
            groupNodeId,
            groupNodeXpath,
            groupCaptionXpath,
            subGroupNodeId,
            subGroupNodeXpath,
            itemNodeId,
            itemNodeXpath,
        } = fieldDef

        if (!xpathAbsolute) continue

        if (!groupNodeId) {
            const nodes = selectNodes(doc, xpathAbsolute)
            if (!nodes.length) continue
            const values = extractValues(nodes, fieldDef)
            if (!values.length) continue
            fieldValues.push({
                fieldId: fieldDef.id,
                name,
                type,
                values,
                sectionNodeId,
                parentNodeId,
                codelistId,
                groupKey: null,
                groupLabel: null,
                subGroupKey: null,
                itemKey: null,
            })
            continue
        }

        const groupInstances = selectNodes(doc, groupNodeXpath)
        if (!groupInstances.length) continue
        const allFieldNodes = selectNodes(doc, xpathAbsolute)
        if (!allFieldNodes.length) continue
        const allCaptionNodes = groupCaptionXpath ? selectNodes(doc, `${groupNodeXpath}/${groupCaptionXpath}`) : []

        for (let gIdx = 0; gIdx < groupInstances.length; gIdx += 1) {
            const instance = groupInstances[gIdx]
            const captionNode = allCaptionNodes.find((candidate) => isDescendantOf(candidate, instance))
            const groupLabel = captionNode?.textContent?.trim() || null

            if (!subGroupNodeXpath) {
                const groupFieldNodes = allFieldNodes.filter((node) => isDescendantOf(node, instance))
                if (!groupFieldNodes.length) continue
                const values = extractValues(groupFieldNodes, fieldDef)
                if (!values.length) continue
                fieldValues.push({
                    fieldId: fieldDef.id,
                    name,
                    type,
                    values,
                    sectionNodeId,
                    parentNodeId,
                    codelistId,
                    groupKey: `${groupNodeId}-${gIdx}`,
                    groupLabel,
                    subGroupKey: null,
                    itemKey: null,
                })
                continue
            }

            const allSubGroupNodes = selectNodes(doc, subGroupNodeXpath)
            const subGroupsInInstance = allSubGroupNodes.filter((node) => isDescendantOf(node, instance))

            if (!itemNodeXpath) {
                for (let sgIdx = 0; sgIdx < subGroupsInInstance.length; sgIdx += 1) {
                    const sgInstance = subGroupsInInstance[sgIdx]
                    const sgFieldNodes = allFieldNodes.filter((node) => isDescendantOf(node, sgInstance))
                    if (!sgFieldNodes.length) continue
                    const values = extractValues(sgFieldNodes, fieldDef)
                    if (!values.length) continue
                    fieldValues.push({
                        fieldId: fieldDef.id,
                        name,
                        type,
                        values,
                        sectionNodeId,
                        parentNodeId,
                        codelistId,
                        groupKey: `${groupNodeId}-${gIdx}`,
                        groupLabel,
                        subGroupKey: `${subGroupNodeId}-${gIdx}-${sgIdx}`,
                        subGroupNodeId,
                        itemKey: null,
                    })
                }
                continue
            }

            const allItemNodes = selectNodes(doc, itemNodeXpath)
            for (let sgIdx = 0; sgIdx < subGroupsInInstance.length; sgIdx += 1) {
                const sgInstance = subGroupsInInstance[sgIdx]
                const itemsInSg = allItemNodes.filter((node) => isDescendantOf(node, sgInstance))
                for (let iIdx = 0; iIdx < itemsInSg.length; iIdx += 1) {
                    const itemInstance = itemsInSg[iIdx]
                    const itemFieldNodes = allFieldNodes.filter((node) => isDescendantOf(node, itemInstance))
                    if (!itemFieldNodes.length) continue
                    const values = extractValues(itemFieldNodes, fieldDef)
                    if (!values.length) continue
                    fieldValues.push({
                        fieldId: fieldDef.id,
                        name,
                        type,
                        values,
                        sectionNodeId,
                        parentNodeId,
                        codelistId,
                        groupKey: `${groupNodeId}-${gIdx}`,
                        groupLabel,
                        subGroupKey: `${subGroupNodeId}-${gIdx}-${sgIdx}`,
                        subGroupNodeId,
                        itemKey: `${itemNodeId}-${gIdx}-${sgIdx}-${iIdx}`,
                    })
                }
            }
        }
    }

    const buyerOrgId = selectText(doc, '//cac:ContractingParty/cac:Party/cac:PartyIdentification/cbc:ID')?.trim() || null
    const eSenderOrgIds = new Set(
        selectNodes(doc, '//cac:ContractingParty/cac:Party/cac:ServiceProviderParty/cac:Party/cac:PartyIdentification/cbc:ID')
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
    )
    const reviewBodyOrgIds = new Set(
        selectNodes(doc, '//cac:AppealTerms/cac:AppealReceiverParty/cac:PartyIdentification/cbc:ID')
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
    )
    const mediationBodyOrgIds = new Set(
        selectNodes(doc, '//cac:AppealTerms/cac:MediationParty/cac:PartyIdentification/cbc:ID')
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
    )

    const sections = groupIntoSections(fieldValues)
    const scope = sections.find((s) => s.nodeId === 'ND-ProcedureProcurementScope' || s.nodeId === 'ND-ProcurementProject')

    const cpSection = sections.find((s) => s.nodeId === 'ND-ContractingParty')
    const orgSection = sections.find((s) => s.nodeId === 'ND-RootExtension' || s.nodeId === 'ND-Organization')
    const suppressCp = cpSection && orgSection && orgSection.groups.length > 0
    if (suppressCp) {
        const targetGroup =
            (buyerOrgId && orgSection.groups.find((g) =>
                g.fields.some((f) => f.fieldId === 'OPT-200-Organization-Company' && f.values?.[0] === buyerOrgId)
            )) || orgSection.groups[0]
        if (targetGroup) {
            for (const cpGroup of cpSection.groups) {
                targetGroup.fields.push(...cpGroup.fields)
            }
        }
    }

    const visibleSections = sections
        .filter((s) => (s.fields.length > 0 || s.groups.length > 0) && !(suppressCp && s.nodeId === 'ND-ContractingParty') && s.nodeId !== 'ND-ProcedureProcurementScope' && s.nodeId !== 'ND-ProcurementProject')
        .sort((a, b) => {
            const ai = DISPLAY_ORDER.indexOf(a.nodeId)
            const bi = DISPLAY_ORDER.indexOf(b.nodeId)
            return (ai < 0 ? 500 : ai) - (bi < 0 ? 500 : bi)
        })

    const orgSource = sections.find((s) => s.nodeId === 'ND-RootExtension' || s.nodeId === 'ND-Organization')
    let firstOrg = null
    if (orgSource) {
        if (buyerOrgId) {
            firstOrg = orgSource.groups.find((g) => getOrgId(g) === buyerOrgId) || null
        }
        if (!firstOrg) {
            firstOrg = orgSource.groups.find((g) =>
                g.fields.some((f) => f.fieldId.startsWith('BT-500')) && !eSenderOrgIds.has(getOrgId(g))
            ) || null
        }
        if (!firstOrg) {
            firstOrg = orgSource.groups.find((g) => g.label && g.fields.some((f) => f.fieldId.startsWith('BT-500'))) || orgSource.groups[0] || null
        }
    }

    const orgFields = firstOrg ? flatFields(firstOrg) : []
    const orgEmail = orgFields.find((f) => f.type === 'email')
    const orgUrl = orgFields.find((f) => f.type === 'url' && !f.name?.includes('galinis taškas'))
    const orgReg = orgFields.find((f) => f.fieldId === 'BT-501-Organization-Company') || orgFields.find((f) => f.name?.includes('Registracijos numeris'))
    const orgCity = orgFields.find((f) => f.name?.toLowerCase().includes('miestas'))

    let deadline = null
    outer: for (const section of sections) {
        for (const group of (section.groups || [])) {
            for (const field of (group.fields || [])) {
                if (field.type === 'date' && field.fieldId?.startsWith('BT-131')) {
                    deadline = field
                    break outer
                }
            }
        }
    }

    const scopeInternalId = scope?.fields?.find((f) => f.fieldId === 'BT-22-Procedure')?.values?.join(', ') || ''
    const scopeContractType = scope?.fields?.find((f) => f.fieldId === 'BT-23-Procedure')?.values?.join(', ') || ''
    const scopeDescription = scope?.fields?.find((f) => f.fieldId === 'BT-24-Procedure')?.values?.join(', ') || ''
    const scopeAddInfo = scope?.fields?.find((f) => f.fieldId === 'BT-300-Procedure')?.values?.join(', ') || ''
    const scopeOtherObj = scope?.fields?.find((f) => f.fieldId === 'BT-531-Procedure')?.values?.join(', ') || ''
    const scopeTitle = scope?.fields?.find((f) => f.name?.startsWith('Pavadinimas'))
    const scopeCpv = scope?.fields?.find((f) => f.name?.includes('pagrindinis klasifikacijos kodas'))
    const scopeAddCpv = scope?.fields?.find((f) => f.name?.includes('kiti klasifikacijos kodai'))
    const scopeValue = scope?.fields?.find((f) => f.type === 'amount') || sections.flatMap((s) => s.fields).find((f) => f.type === 'amount')
    const scopeAddrFields = scope?.fields?.filter((f) => f.parentNodeId === 'ND-ProcedurePlacePerformance' || f.parentNodeId === 'ND-ProcedurePlacePerformanceAdditionalInformation') || []
    const scopeCpvParts = splitCpvLabel(scopeCpv?.values?.[0] || '')
    const scopeAddCpvParts = (scopeAddCpv?.values || []).map((value) => splitCpvLabel(value)).filter((item) => item.code || item.label)

    const timelineItems = [
        notice.issueDate && { label: 'Paskelbta', date: notice.issueDate, text: formatDate(notice.issueDate) },
        deadline && { label: 'Pasiūlymų terminas', date: deadline.values[0], text: formatDate(deadline.values[0]) },
    ].filter(Boolean)

    return {
        ...notice,
        sections,
        visibleSections,
        buyerOrgId,
        eSenderOrgIds,
        reviewBodyOrgIds,
        mediationBodyOrgIds,
        pageTitle: scopeTitle?.values?.[0] || notice.documentTypeLabel,
        noticeId: notice.id,
        documentTypeLabel: notice.documentTypeLabel,
        subTypeDescription: notice.subTypeDescription,
        issueDateText: notice.issueDate ? formatDate(notice.issueDate) : '',
        timelineItems,
        hasLocation: scopeAddrFields.length > 0,
        procScope: {
            internalId: scopeInternalId,
            contractType: scopeContractType,
            description: scopeDescription,
            addInfo: scopeAddInfo,
            otherObj: scopeOtherObj,
            cpv: scopeCpv,
            bvpzPavadinimas: scopeCpvParts.label || scopeCpvParts.code,
            bvpzKodas: scopeCpvParts.code,
            papildomiBvpzPavadinimai: scopeAddCpvParts.map((item) => item.label || item.code),
            papildomiBvpzKodai: scopeAddCpvParts.map((item) => item.code),
            value: scopeValue,
            addrFields: scopeAddrFields,
        },
        primaryOrg: firstOrg
            ? {
                label: firstOrg.label,
                reg: orgReg?.values?.[0] || '',
                city: orgCity?.values?.[0] || '',
                email: orgEmail?.values?.[0] || '',
                url: orgUrl?.values?.[0] || '',
                fields: orgFields,
            }
            : null,
        formatDate,
        escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
        },
        shortUrl(value) {
            try {
                return new URL(value).hostname
            } catch {
                const stringValue = String(value)
                return stringValue.length > 55 ? `${stringValue.slice(0, 52)}…` : stringValue
            }
        },
        PARENT_NODE_TITLES,
        PARENT_NODE_ALIASES,
        SUBGROUP_TITLES,
    }
}

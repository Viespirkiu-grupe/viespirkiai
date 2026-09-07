import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTedNoticeViewModel } from '../modules/ted/viewer.js';

function sample(name: string) {
  return buildTedNoticeViewModel(readFileSync(join('modules', 'ted', 'samples', `${name}.xml`), 'utf-8'));
}

function allFieldIds(view: any) {
  const ids: string[] = [];
  for (const section of view.sections) {
    for (const field of section.fields) ids.push(field.fieldId);
    for (const group of section.groups) {
      for (const field of group.fields) ids.push(field.fieldId);
      for (const subGroup of group.subGroups ?? []) {
        for (const field of subGroup.fields) ids.push(field.fieldId);
        for (const item of subGroup.items ?? []) for (const field of item.fields) ids.push(field.fieldId);
      }
    }
  }
  return ids;
}

const RESULT_NOTICE = `<?xml version="1.0" encoding="UTF-8"?>
<ContractAwardNotice
  xmlns="urn:oasis:names:specification:ubl:schema:xsd:ContractAwardNotice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:efac="http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1"
  xmlns:efbc="http://data.europa.eu/p27/eforms-ubl-extension-basic-components/1"
  xmlns:efext="http://data.europa.eu/p27/eforms-ubl-extensions/1"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <efext:EformsExtension>
          <efac:NoticeResult>
            <efac:LotResult>
              <cbc:ID schemeName="result">RES-0001</cbc:ID>
              <cbc:TenderResultCode listName="winner-selection-status">clos-nw</cbc:TenderResultCode>
              <efac:DecisionReason>
                <efbc:DecisionReasonCode listName="non-award-justification">all-rej</efbc:DecisionReasonCode>
              </efac:DecisionReason>
              <efac:ReceivedSubmissionsStatistics>
                <efbc:StatisticsCode listName="received-submission-type">t-esubm</efbc:StatisticsCode>
                <efbc:StatisticsNumeric>2</efbc:StatisticsNumeric>
              </efac:ReceivedSubmissionsStatistics>
              <efac:TenderLot><cbc:ID>LOT-0001</cbc:ID></efac:TenderLot>
            </efac:LotResult>
          </efac:NoticeResult>
        </efext:EformsExtension>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:ID schemeName="notice-id">notice-id</cbc:ID>
  <cbc:IssueDate>2025-10-24</cbc:IssueDate>
  <cbc:NoticeTypeCode listName="result">can-standard</cbc:NoticeTypeCode>
</ContractAwardNotice>`;

describe('TED result notices', () => {
  it('keeps lot results separate from the organizations section', () => {
    const view = buildTedNoticeViewModel(RESULT_NOTICE);
    const result = view.visibleSections.find((section: any) => section.nodeId === 'ND-LotResult');

    expect(result?.title).toBe('Rezultatai');
    expect(result?.groups[0].label).toBe('LOT-0001');
    expect(result?.groups[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldId: 'BT-142-LotResult',
        values: ['Nepasirinktas nė vienas laimėtojas ir konkursas baigtas.'],
      }),
      expect.objectContaining({
        fieldId: 'BT-144-LotResult',
        values: ['Visi pasiūlymai, dalyvavimo prašymai ar projektai atšaukti arba nepriimtini'],
      }),
    ]));
    expect(result?.groups[0].subGroups[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldId: 'BT-759-LotResult', values: ['2'] }),
      expect.objectContaining({
        fieldId: 'BT-760-LotResult',
        values: ['Elektroninėmis priemonėmis pateikti pasiūlymai'],
      }),
    ]));
  });
});

describe('TED apžvalgos laukai', () => {
  it('randa BVPŽ pagal BT numerį, o ne pagal etiketės tekstą', () => {
    const view = sample('cn_24_maximal');
    expect(view.procScope.bvpzKodas).toBe('79710000');
    expect(view.procScope.bvpzPavadinimas).toBe('Apsaugos paslaugos');
    expect(view.procScope.papildomiBvpzKodai).toEqual(['79720000']);
  });

  it('BVPŽ randamas visuose pavyzdiniuose skelbimuose', () => {
    for (const name of ['can_24_minimal', 'cn_24_minimal', 'cn_24_multilingual', 'pin-buyer_24_minimal']) {
      expect(sample(name).procScope.bvpzKodas, name).toMatch(/^\d{8}$/);
    }
  });

  it('skelbimo potipį atpažįsta pagal `type` ir pateikia lietuviškai', () => {
    expect(sample('cn_24_maximal').subTypeDescription).toBe('Skelbimas apie viešąjį pirkimą; bendroji direktyva, įprasta tvarka');
    expect(sample('can_24_minimal').subTypeDescription).toBe('Skelbimas apie sutarties skyrimą; bendroji direktyva, įprasta tvarka');
  });

  it('daugiakalbiame skelbime grupių pavadinimus ima lietuviškai', () => {
    expect(sample('cn_24_multilingual').primaryOrg.label).toBe('Europos Sąjungos leidinių biuras');
  });

  it('kodų sąrašų „taip“ / „ne“ suvienodina su indikatoriais', () => {
    const view = sample('cn_24_maximal');
    const accelerated = view.sections
      .flatMap((section: any) => section.fields)
      .find((field: any) => field.fieldId === 'BT-106-Procedure');
    expect(accelerated?.values).toEqual(['Taip']);
  });

  it('/asmuo/ nuorodą siūlo tik lietuviškiems registracijos kodams', () => {
    expect(sample('cn_24_maximal').primaryOrg.regLink).toBeNull();
    expect(sample('cn_24_minimal').primaryOrg.regLink).toBeNull();
    expect(sample('cn_24_maximal').ltRegCode('188675190', 'Lietuva')).toBe('188675190');
    expect(sample('cn_24_maximal').ltRegCode('EU-PO', 'Liuksemburgas')).toBeNull();
  });

  it('nulinės vertės nerodo kaip skelbimo vertės', () => {
    const view = buildTedNoticeViewModel(
      readFileSync(join('modules', 'ted', 'samples', 'cn_24_maximal.xml'), 'utf-8').replaceAll(
        'currencyID="EUR">9999999.99<',
        'currencyID="EUR">0<',
      ),
    );
    expect(view.procScope.value).toBeNull();
  });

  it('adresams be schemos prideda https://, kad href nebūtų reliatyvus', () => {
    const view = buildTedNoticeViewModel(
      readFileSync(join('modules', 'ted', 'samples', 'cn_24_maximal.xml'), 'utf-8')
        .replace('https://www.fin-adm.com', 'www.fin-adm.com'),
    );
    expect(view.primaryOrg.url).toBe('https://www.fin-adm.com');
  });

  it('sutarties ir pasiūlymo grupės lieka matomose sekcijose', () => {
    const ids = allFieldIds(sample('can_24_minimal'));
    expect(ids).toContain('BT-145-Contract');
    expect(ids).toContain('BT-720-Tender');
  });
});

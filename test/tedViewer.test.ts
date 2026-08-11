import { describe, expect, it } from 'vitest';
import { buildTedNoticeViewModel } from '../modules/ted/viewer.js';

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

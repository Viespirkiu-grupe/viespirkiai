const label = (
  labels: Record<string, string>,
  input: unknown,
  fallback = '—',
) => labels[String(input ?? '')] ?? (input == null || input === '' ? fallback : String(input));

export const cvppReportTypeLabel = (input: unknown) => label({
  1: 'ATN-1',
  2: 'ATN-2',
  3: 'ATN-3',
  4: 'AtGn-1',
  5: 'AtGn-2',
  6: 'Atk-1',
}, input, 'Ataskaita');

export const cvppDumpAtn1AwardProcedureLabel = (input: unknown) => label({
  PROCTYPE_OPEN: 'Atviras konkursas',
  PROC_TYPE_NEGOTIATED_WO_PUB: 'Neskelbiamos derybos',
  PROC_TYPE_NEGOTIATED_WITH_PUB: 'Skelbiamos derybos',
  PROCTYPE_RESTRICTED: 'Ribotas konkursas',
  AWARD_DYNAMIC_PURCHASE: 'Pirkimas dinaminės pirkimo sistemos pagrindu',
  PROC_TYPE_DYNAMIC_PURCHASE: 'Dinaminė pirkimo sistema',
  PROCTYPE_INNOVATION: 'Inovacijų partnerystė',
  PROCTYPE_COMP_DIALOGUE: 'Konkurencinis dialogas',
}, input);

export const cvppDumpAtn1ProcedureEndLabel = (input: unknown) => label({
  CONCLUDING_THE_CONTRACT: 'Sudaryta pirkimo sutartis',
  REJECTING_REQUEST_TO_TENDERS: 'Atmestos visos paraiškos ar pasiūlymai',
  DO_NOT_SUBMIT_REQUEST_WITHIN_TIME:
    'Per nustatytą terminą nepateikta paraiškų ar pasiūlymų',
  TERMINATING_THE_PROCUREMENT: 'Pirkimo procedūros nutrauktos',
  SUPPLIER_WITHDRAAW_TENDERS:
    'Tiekėjai atsiėmė pasiūlymus arba atsisakė sudaryti sutartį',
  EXPIRY_OF_VALIDITY_PERIOD_OF_TENDER:
    'Pasibaigė pasiūlymų galiojimo laikas',
}, input);

export const cvppDumpAtn1YesNoUnknownLabel = (input: unknown) => {
  if (input === true) return 'Taip';
  if (input === false) return 'Ne';

  return label({
    YES: 'Taip',
    NO: 'Ne',
    UNKNOWN: 'Nežinoma',
  }, input);
};

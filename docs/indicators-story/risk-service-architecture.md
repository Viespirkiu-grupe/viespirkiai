# Procurement Risk Service Architecture

## 1. Procurement Risk Process

### 1.1 Procurement Risk Process Diagram

```mermaid
flowchart LR
    CRON["Task Scheduler<br/>(triggers batch run)"]
    READER["Procurement Reader<br/>(loads valid procurements)"]

    subgraph ENGINE["Risk Decision Engine — per Risk Indicator, per subject"]
        direction LR
        ELIG{"isEligible(subject)"}
        ASSESS["assessRisk(subject)"]
        SIGE(["RiskSignal<br/>insufficient_data / not_applicable"])
        SIGA(["RiskSignal<br/>triggered / not_triggered"])
        ELIG -->|" not eligible "| SIGE
        ELIG -->|" eligible "| ASSESS
        ASSESS --> SIGA
    end

    WRITER["Signal Writer<br/>(persists risk signals)"]
    STORE[("risk.risk_signals")]
    CRON -->|" run trigger "| READER
    READER -->|" Procurement + Lots "| ELIG
    SIGE --> WRITER
    SIGA --> WRITER
    WRITER -->|" risk_signals rows "| STORE
```

### 1.2 Procurement Reader and Procurement Writer Components Class Diagram

```mermaid
classDiagram
    class ProcurementReader {
        <<class>>
        -PROCUREMENT_SQL
        -LOT_SQL
        +loadProcurements(subjects: string[], cursor: string, pageSize: number)$ Page~Procurement~
    }
    note for ProcurementReader "Orphan lots (no matching procurement) can't happen by business invariant.
    If LOT_SQL still returns one, log its count at WARNING and drop it — it is not a Subject."

    class Page~T~ {
        <<type>>
        +T[] items
        +string nextCursor
    }

    class SignalWriter {
        <<class>>
        -EvaluationRun evaluationRun
        +writeRiskSignals(signals: RiskSignal[])$ number
        +updateEvaluationRun(update: Partial EvaluationRun)$ EvaluationRun
    }
    note for SignalWriter "updateEvaluationRun upserts: first call inserts the run row, later calls update it —
    accumulating per-indicator stats across pages. No crash recovery, no retry."

    class RunJob {
        <<module runJob.ts>>
        +runEvaluation(options: RunJobOptions)$ RunResult
    }

    class RiskDecisionEngine {
        -riskIndicators: RiskIndicatorDecision[]
        +evaluateAll(procurements: Procurement[])$ RiskSignal[]
        -evaluateProcurement(procurement: Procurement)$ RiskSignal[]
        -evaluateLot(lot: ProcurementLot)$ RiskSignal[]
    }

    class RunJobOptions {
        <<type>>
        +string[] subjects
        +number pageSize
    }

    class RunResult {
        <<type>>
        +number runId
        +RunStatus status
    }

    class EvaluationRun {
        <<type>>
        +number runId
        +RunStatus status
        +timestamp dataAsOf
        +object statistics
    }

    class RunStatus {
        <<enumeration>>
        running
        succeeded
        partial
        failed
    }

    EvaluationRun "1" --> "1" RunStatus: status
    RunResult "1" --> "1" RunStatus: status
    RunJob ..> RunJobOptions: options
    RunJob --> RunResult: returns

    RunJob ..> ProcurementReader : loop — loads next page (subjects filter, cursor) until nextCursor is null
    ProcurementReader --> Page : returns
    RunJob ..> RiskDecisionEngine : evaluates single batch of procurements
    RunJob ..> SignalWriter : writes page's signals
    RunJob ..> SignalWriter : updateEvaluationRun(status, stats) — inserts on first call, updates after
```

## 2. Procurement Business Object

### 2.1 Diagram

```mermaid
classDiagram
    class Procurement {
        +text saltinis
        +text pirkimoNumeris
        +text pavadinimas
        +text jarKodas
        +text pirkimoBudas
        +text statusas
        +text pirkimoObjektoTipas
        +numeric numatomaVerteEUR
        +date paskelbimoData
        +timestamp pasiulymuPateikimoTerminas
        +text[] bvpzKodai
        +boolean esFinansavimas
        +ProcurementLot[] lots
    }
    class ProcurementLot {
        +text subjektoRaktas
        +text saltinis
        +text pirkimoNumeris
        +text daliesNumeris
        +text daliesPavadinimas
        +boolean deklaruota
        +boolean stebeta
        +integer dalyviuSkaicius
        +integer kainuSkaicius
        +integer atmestuSkaicius
    }
    Procurement "1" *-- "0..*" ProcurementLot: lots
```

### 2.2 Field Provenance

| Business Object | Domain Model View | Key                           |
|------------------|-------------------|-------------------------------|
| Procurement      | `v_pirkimas`      | `saltinis` + `pirkimoNumeris` |
| ProcurementLot    | `v_pirkimo_dalis` | `subjektoRaktas`              |

## 3. Risk Decision Services (DRD)

### Decision Areas

- **Procurement Risk Decision Service** (subject: `procurement`)
- **Procurement Lot Risk Decision Service** (subject: `lot`).

### 3.1 Legend

| Shape                     | DMN Element              |
|---------------------------|--------------------------|
| Rectangle                 | Decision                 |
| Rounded (`([...])`)       | Input Data               |
| Leaning sides (`[/.../]`) | Business Knowledge Model |
| Flag (`>...]`)            | Knowledge Source         |
| Bounding box (subgraph)   | Decision Service         |

### 3.2 Diagram

```mermaid
flowchart BT
    IDP(["Procurement"])
    IDL(["ProcurementLot"])

    subgraph DSP["Procurement Risk Decision Service"]
        EDP["Procurement Eligibility Decision"]
        P1["LT-PRO-08<br/>Short submission period"]
        P2["LT-PRI-05<br/>High estimated value"]
        P3["LT-TRA-01<br/>Planning documents unavailable"]
        P4["LT-COM-03<br/>Only one supplier invited"]
        PREST["24 more Procurement Risk Indicators"]
        RDP["Procurement Risk Decision"]
    end

    subgraph DSL["Procurement Lot Risk Decision Service"]
        EDL["Lot Eligibility Decision"]
        L1["LT-COM-01<br/>Single valid bid"]
        L2["LT-COM-02<br/>Low number of bidders"]
        L3["LT-PRI-01<br/>Value vs market benchmark"]
        LREST["14 more Lot Risk Indicators"]
        RDL["Lot Risk Decision"]
    end

    IDP --> EDP
    IDP --> P1
    IDP --> P2
    IDP --> P3
    IDP --> P4
    IDP --> PREST
    EDP --> P1
    EDP --> P2
    EDP --> P3
    EDP --> P4
    EDP --> PREST
    P1 --> RDP
    P2 --> RDP
    P3 --> RDP
    P4 --> RDP
    PREST --> RDP
    EDP --> RDP
    IDL --> EDL
    IDL --> L1
    IDL --> L2
    IDL --> L3
    IDL --> LREST
    EDL --> L1
    EDL --> L2
    EDL --> L3
    EDL --> LREST
    L1 --> RDL
    L2 --> RDL
    L3 --> RDL
    LREST --> RDL
    EDL --> RDL
```

### 3.3 Decision Tables: Eligibility Decisions

#### Procurement Eligibility Decision

| Input: `pirkimoBudas` present | Input: `saltinis` | Output: Eligibility |
|-------------------------------|-------------------|---------------------|
| yes                           | `cvpis`           | eligible            |
| no                            | `cvpp`            | not eligible        |

#### Lot Eligibility Decision

| Input: Parent Procurement Eligibility | Input: `deklaruota` | Output: Eligibility |
|----------------------------------------|----------------------|----------------------|
| eligible                               | true                  | eligible             |
| eligible                               | false                 | not eligible         |
| not eligible                           | any                   | not eligible         |

### 3.4 Risk Indicator Definition

```mermaid
classDiagram
    class RiskIndicatorDefinition~P~ {
        <<interface>>
        +string id
        +number version
        +SubjectType subjectType
        +IndicatorStage stage
        +string[] references
        +string[] sourceRelations
        +string[] requiredInputs
        +ParameterEntry~P~[] parameters
        +RiskIndicatorStandard standard
        +RiskIndicatorPublicText public
    }
    class RiskIndicatorDecision {
        <<interface>>
        +isEligible(subject: Subject) EligibilityOutcome
        +assessRisk(subject: Subject) RiskSignal
    }
    class ARiskIndicatorDecision~F D~ {
        <<abstract>>
        +D definition
        +isEligible(subject: Subject) EligibilityOutcome*
        +assessRisk(subject: Subject) RiskSignal
    }
    class AProcurementIndicatorDecision~F D~ {
        <<abstract>>
        +isEligible(subject: Subject) EligibilityOutcome
    }
    class ALotIndicatorDecision~F D~ {
        <<abstract>>
        +isEligible(subject: Subject) EligibilityOutcome
    }
    class RiskIndicatorStandard {
        <<interface>>
        +string name
        +string url
        +number page
    }
    class RiskIndicatorPublicText {
        <<interface>>
        +string titleLt
        +string descriptionLt
        +string formulaLt
        +string limitationLt
    }
    class ParameterEntry {
        <<interface>>
        +string validFrom
        +string validTo
        +string source
        +string note
    }
    note for ParameterEntry "P's own fields (the indicator's parameter values)
    are intersected directly onto the entry, not nested under a values key."
    class SubjectType {
        <<enumeration>>
        procurement, lot,
        contract, supplier
    }
    class EligibilityOutcome {
        <<type>>
        eligible
        RiskSignal
    }
    class Subject {
        <<type>>
        Procurement
        ProcurementLot
    }
    note for Subject "Procurement | ProcurementLot — full fields in §2.1.
    subjectType/subjectKey/procurementSource/procurementId (carried by RiskSignal below) are
    derived from each object's own key (§2.2: saltinis+pirkimoNumeris for Procurement,
    subjektoRaktas for ProcurementLot), not stored as separate fields on the object itself."
    class RiskSignal {
        <<interface>>
        +string indicatorId
        +SubjectType subjectType
        +string subjectKey
        +string procurementSource
        +string procurementId
        +SignalState state
        +object rawValue
        +object threshold
        +object appliedParameters
        +object evidence
        +string[] missingData
        +string dataAsOf
    }
    class SignalState {
        <<enumeration>>
        triggered
        not_triggered
        insufficient_data
        not_applicable
        calculation_error
    }

    RiskIndicatorDefinition "1" --> "1" SubjectType: subjectType
    RiskIndicatorDefinition "1" *-- "1" RiskIndicatorStandard: standard
    RiskIndicatorDefinition "1" *-- "1" RiskIndicatorPublicText: public
    RiskIndicatorDefinition "1" *-- "0..*" ParameterEntry: parameters
    ARiskIndicatorDecision ..|> RiskIndicatorDecision
    ARiskIndicatorDecision "1" *-- "1" RiskIndicatorDefinition: definition
    AProcurementIndicatorDecision --|> ARiskIndicatorDecision
    ALotIndicatorDecision --|> ARiskIndicatorDecision
    RiskIndicatorDecision "1" ..> "1" Subject: isEligible(subject)
    RiskIndicatorDecision "1" ..> "1" Subject: assessRisk(subject)
    RiskIndicatorDecision "1" ..> "1" EligibilityOutcome: isEligible() returns
    RiskIndicatorDecision "1" ..> "1" RiskSignal: assessRisk() returns
    EligibilityOutcome "1" ..> "0..1" RiskSignal: when not eligible
    RiskSignal "1" --> "1" SignalState: state
```

### 3.5 Per-Indicator File Layout

Each deployed indicator version is one directory under `modules/risk/indicators/<CODE>/`:

| File            | Holds                                                                                                                                                                                   |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `definition.ts` | The `RiskIndicatorDefinition` object — identity, references, standard, public wording, and the effective-dated parameter timeline. Pure data; no imports of `ARiskIndicatorDecision`. Used in GUI and found in registry. |
| `decision.ts`   | The `ARiskIndicatorDecision` subclass that exposes `isEligible` and `assessRisk`                                                                                                        |
| `test/`         | Unit tests against risk indicator class                                                                                                                                                 |

## 4. Open Questions

| # | Question                                                                                                                                                                                                                               |
|---|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Is one shared Procurement Eligibility Decision sufficient for all 28 indicators, or do some need their own additional eligibility rule? ANSWER: you will extend DRD on demand.                                                         |
| 2 | Where does `requiredInputs` / Data Eligibility Decision sit in this v2 model — inside each Risk Indicator, or as a second shared decision beside Procurement Eligibility Decision? ANSWER: you will read all domain element view data. |

// AG Studio's data sources for Proofline: projects, evidence items, the completeness matrix and the
// open gaps, all from the evidence ledger (lib/store.ts), plus a calendar and a few measures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from 'ag-studio';
import type { ProoflineData } from '@/lib/store';

const CALENDAR_ID = 'calendar';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: 'many-to-one',
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
});

const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: 'percentageFormat',
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const hasData = (data: ProoflineData) => data.projects.length > 0;

export function buildStudioData(data: ProoflineData): AgDataSourcesDefinition {
  const dates = [...data.projects.map((r) => r.paidDate), ...data.evidence.map((r) => r.capturedDate)]
    .filter((d): d is string => !!d)
    .sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      'Proofline: fulfilment evidence for a freelancer who sells digital work and services through PayPal. ' +
      'Each project is one client commission paid through PayPal. Evidence items are what the seller can show PayPal if a payment is held, ' +
      'the account is reviewed or a dispute is opened. The matrix has one row per project and required evidence type. ' +
      'Rows marked Sample are seeded demo data. All amounts are USD.',
    sources: [
      {
        id: 'projects',
        description: 'One row per client project. At risk is the paid amount of projects that are missing required evidence.',
        data: data.projects,
        fields: fields([
          // Visible on purpose: AG Studio's widget schema leaves out hidden fields, and the evidence
          // matrix needs the project id to group cells and to cross-filter.
          ['id', 'Project ID', 'textFormat'],
          ['title', 'Project', 'textFormat'],
          ['client', 'Client', 'textFormat'],
          ['status', 'Project Status', 'textFormat'],
          ['stage', 'Stage', 'integerFormat', true],
          ['posture', 'Evidence Posture', 'textFormat'],
          ['price', 'Price', 'currencyFormat'],
          ['paidAmount', 'Paid', 'currencyFormat'],
          ['atRisk', 'At Risk', 'currencyFormat'],
          ['paidDate', 'Paid Date', 'dateFormat'],
          ['deliveredDate', 'Delivered Date', 'dateFormat'],
          ['evidenceItems', 'Evidence Items', 'integerFormat'],
          ['missingItems', 'Missing Items', 'integerFormat'],
          ['completeness', 'Completeness', 'percentageFormat'],
          ['sample', 'Sample', 'booleanFormat'],
        ]),
      },
      {
        id: 'evidence',
        description: 'Every evidence item on file, with where it came from, how far it can be trusted and its fingerprint (first 12 hex characters of its sha256).',
        data: data.evidence,
        fields: fields([
          ['id', 'Evidence ID', 'textFormat', true],
          ['projectId', 'Project ID', 'textFormat', true],
          ['type', 'Evidence Type', 'textFormat'],
          ['title', 'Evidence', 'textFormat'],
          ['provenance', 'Provenance', 'textFormat'],
          ['source', 'Source', 'textFormat'],
          ['capturedAt', 'Captured At', 'dateTimeFormat'],
          ['capturedDate', 'Captured Date', 'dateFormat', true],
          ['fingerprint', 'Fingerprint', 'textFormat'],
          ['sample', 'Sample Evidence', 'booleanFormat'],
        ]),
      },
      {
        id: 'matrix',
        name: 'Evidence Matrix',
        description: 'One row per project and evidence type. State is present, missing (required now) or not_yet (not required at this stage).',
        data: data.matrix,
        fields: fields([
          ['id', 'Cell ID', 'textFormat', true],
          ['projectId', 'Project ID', 'textFormat', true],
          ['evidenceType', 'Required Evidence', 'textFormat'],
          ['state', 'Evidence State', 'textFormat'],
          ['provenance', 'Best Provenance', 'textFormat'],
          ['present', 'Present', 'integerFormat'],
          ['missing', 'Missing', 'integerFormat'],
          ['required', 'Required', 'integerFormat'],
          ['presentRequired', 'Required Present', 'integerFormat'],
          ['evidenceTitle', 'Matched Evidence', 'textFormat'],
          ['capturedAt', 'Matched Captured At', 'dateTimeFormat'],
          ['fingerprint', 'Matched Fingerprint', 'textFormat'],
          ['source', 'Matched Source', 'textFormat'],
          ['sampleEvidence', 'Matched Is Sample', 'booleanFormat'],
          ['nextStep', 'Gap Next Step', 'textFormat'],
        ]),
      },
      {
        id: 'gaps',
        description: 'Required evidence that is missing, with the next step to close each gap.',
        data: data.gaps,
        fields: fields([
          ['id', 'Gap ID', 'textFormat', true],
          ['projectId', 'Project ID', 'textFormat', true],
          ['missing', 'Missing Evidence', 'textFormat'],
          ['nextStep', 'Next Step', 'textFormat'],
          ['atRisk', 'Gap At Risk', 'currencyFormat'],
        ]),
      },
    ],
    relationships: [
      manyToOne('evidence-project', 'evidence.projectId', 'projects.id'),
      manyToOne('matrix-project', 'matrix.projectId', 'projects.id'),
      manyToOne('gap-project', 'gaps.projectId', 'projects.id'),
      onCalendar('projects', 'paidDate'),
      onCalendar('evidence', 'capturedDate'),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: {
          from: { type: 'date', value: dates[0] ?? today },
          to: { type: 'date', value: dates.at(-1) ?? today },
        },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      ratio('evidenceCoverage', 'Evidence Coverage', 'Required evidence present / required evidence.', 'matrix.presentRequired', 'matrix.required'),
      ratio('moneyAtRiskShare', 'Share of Paid at Risk', 'Paid amount on projects missing evidence / all paid.', 'projects.atRisk', 'projects.paidAmount'),
    ],
  };
}

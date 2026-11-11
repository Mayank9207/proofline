// The built-in "Proofline command center" report: evidence posture across every PayPal-paid
// project, the projects themselves, and the evidence on file. Field ids ('projects.atRisk') refer
// to the data sources in ./data.ts; 'evidence-matrix' and 'evidence-timeline' are the custom
// widgets in ./widgets.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

const FONT = '"PayPal Open", "Helvetica Neue", Helvetica, Arial, sans-serif';
const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({
  fontFamily: FONT,
  fontSize,
  fontWeight,
  fontStyle: 'normal' as const,
});

const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'countd' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text, typography: typography(14, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(22) },
  },
});

const posture: AgPageState = {
  id: 'posture',
  widgets: {
    'kpi-paid': kpi('Paid through PayPal', sum('projects.paidAmount')),
    'kpi-at-risk': kpi('Paid, evidence missing', sum('projects.atRisk')),
    'kpi-missing': kpi('Missing evidence items', sum('projects.missingItems')),
    'kpi-coverage': kpi('Evidence coverage', { id: 'evidenceCoverage' }),
    // Custom widget types (./widgets.tsx) aren't in Studio's built-in type union.
    matrix: {
      type: 'evidence-matrix',
      format: title('Evidence matrix: what each project can prove today'),
    } as never,
    'posture-donut': {
      type: 'donut-chart',
      dataMapping: {
        categoryKey: [{ id: 'projects.posture' }],
        valueKey: [sum('projects.price')],
      },
      format: title('Project value by evidence posture'),
    },
    gaps: {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'projects.title' }, { id: 'projects.client' }, { id: 'gaps.missing' }, { id: 'gaps.nextStep' }, sum('gaps.atRisk')],
      },
      sort: [{ field: sum('gaps.atRisk'), direction: 'desc' }],
      format: title('Open gaps and the next step for each'),
    },
    'recent-activity': {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'evidence.capturedAt' }, { id: 'projects.title' }, { id: 'evidence.title' }, { id: 'evidence.provenance' }],
      },
      sort: [{ field: { id: 'evidence.capturedAt' }, direction: 'desc' }],
      format: title('Recent activity: newest evidence first'),
    },
  },
  widgetLayout: {
    'kpi-paid': at(0, 0, 6, 7),
    'kpi-at-risk': at(6, 0, 6, 7),
    'kpi-missing': at(12, 0, 6, 7),
    'kpi-coverage': at(18, 0, 6, 7),
    matrix: at(0, 7, 16, 22),
    'posture-donut': at(16, 7, 8, 22),
    gaps: at(0, 29, 13, 20),
    'recent-activity': at(13, 29, 11, 20),
  },
};

const projects: AgPageState = {
  id: 'projects',
  widgets: {
    timeline: {
      type: 'evidence-timeline',
      format: title('Evidence timeline: when each proof was captured'),
    } as never,
    'project-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'projects.title' },
          { id: 'projects.client' },
          { id: 'projects.status' },
          { id: 'projects.posture' },
          { id: 'projects.paidDate' },
          sum('projects.price'),
          sum('projects.evidenceItems'),
          sum('projects.missingItems'),
          { id: 'projects.sample' },
        ],
      },
      sort: [{ field: sum('projects.missingItems'), direction: 'desc' }],
      format: title('Projects'),
    },
  },
  widgetLayout: {
    timeline: at(0, 0, 24, 22),
    'project-grid': at(0, 22, 24, 18),
  },
};

const evidence: AgPageState = {
  id: 'evidence',
  widgets: {
    'by-provenance': {
      type: 'donut-chart',
      dataMapping: {
        categoryKey: [{ id: 'evidence.provenance' }],
        valueKey: [countd('evidence.id')],
      },
      format: title('Evidence by provenance'),
    },
    'by-type': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'evidence.type' }],
        valueKey: [countd('evidence.id')],
      },
      format: title('Evidence items by type'),
    },
    'evidence-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'projects.title' },
          { id: 'evidence.type' },
          { id: 'evidence.title' },
          { id: 'evidence.provenance' },
          { id: 'evidence.source' },
          { id: 'evidence.capturedAt' },
          { id: 'evidence.fingerprint' },
        ],
      },
      sort: [{ field: { id: 'evidence.capturedAt' }, direction: 'desc' }],
      format: title('Evidence on file (fingerprint = first 12 characters of sha256)'),
    },
  },
  widgetLayout: {
    'by-provenance': at(0, 0, 8, 20),
    'by-type': at(8, 0, 16, 20),
    'evidence-grid': at(0, 20, 24, 22),
  },
};

export const dashboardReport: AgReportState = {
  selectedPageId: posture.id,
  pages: [posture, projects, evidence],
};

'use client';

// Proofline's custom AG Studio widgets.
//
// - Evidence Matrix: projects x required evidence types, each cell present / missing / not yet,
//   coloured by the best provenance on file. Clicking a project name cross-filters the page;
//   clicking a cell opens a card with that evidence's provenance, time, source and fingerprint.
// - Evidence Timeline: one lane per project, a marker for every evidence item at the time it was
//   captured, shaped by provenance.
//
// Both read Studio's own data (so page filters and cross filters apply) through the widget API:
// they look their fields up in the report schema and run a flat query. Studio re-renders the widget
// when its data or filters change.

import { useEffect, useState } from 'react';
import { createWidgets } from 'ag-studio-react';
import type { AgWidgetApi, AgWidgetField, AgWidgetParams } from 'ag-studio';

type Row = Record<string, unknown>;

function useFlatRows(widgetApi: AgWidgetApi, fieldIds: string[]) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const key = fieldIds.join('|');

  useEffect(() => {
    let cancelled = false;
    // Note: getSchema() leaves out fields marked `hide` in the data sources, so every field a
    // widget reads must be visible there (see app/dashboard/studio/data.ts).
    const tables = widgetApi.getSchema();
    const fields: AgWidgetField[] = [];
    const missing: string[] = [];
    for (const id of fieldIds) {
      let field: AgWidgetField | undefined;
      for (const t of tables) {
        field = t.fields.find((f) => f.fieldId === id || `${t.id}.${f.fieldId}` === id || f.key === id);
        if (field) break;
      }
      if (field) fields.push(field);
      else missing.push(id);
    }
    if (missing.length > 0) {
      console.warn('[Proofline widget] fields not found in the report schema', missing, 'available:',
        tables.flatMap((t) => t.fields.map((f) => f.fieldId)));
      widgetApi.setDisplayState('noData');
      return;
    }
    // Row values come back keyed by each field's `key`; hand them back keyed by field id.
    const toRows = (raw: Row[]) =>
      raw.map((r) => Object.fromEntries(fields.map((f, i) => [fieldIds[i], r[f.key]])));
    widgetApi.setDisplayState('loading');
    widgetApi
      .getData({ kind: 'flat', fields }, { queryId: 'rows' })
      .then((response) => {
        if (cancelled || (response as { replaced?: boolean }).replaced) return;
        const next = toRows(response.results.rows);
        setRows(next);
        widgetApi.setDisplayState(next.length ? 'displayed' : 'noData');
      })
      .catch(() => !cancelled && widgetApi.setDisplayState('noData'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApi, key]);

  return rows;
}

const PROVENANCE_COLOUR: Record<string, string> = {
  'System verified': '#0a7d3b',
  'Client confirmed': '#2f6fdb',
  'Self reported': '#b7791f',
};

const EVIDENCE_ORDER = ['Agreed scope', 'PayPal payment', 'Delivered file', 'Client acknowledgment', 'Completion recorded in PayPal'];

// --- Evidence Matrix ---------------------------------------------------------------------
// Options (edit panel, also settable by Studio's AI through widget state):
//   format.style.onlyMissing  boolean  hide projects with nothing missing (default false)
//   format.style.sortBy       'atRisk' | 'completeness' | 'title'  (default 'atRisk')
//   format.style.showLegend   boolean  (default true)

type MatrixStyle = { onlyMissing?: boolean; sortBy?: 'atRisk' | 'completeness' | 'title'; showLegend?: boolean };

type Cell = {
  state: string;
  provenance: string | null;
  evidenceTitle: string | null;
  capturedAt: string | null;
  fingerprint: string | null;
  source: string | null;
  sample: boolean;
  nextStep: string | null;
};

type MatrixProject = { title: string; atRisk: number; completeness: number; cells: Map<string, Cell> };

function EvidenceMatrix({ widgetApi, format }: AgWidgetParams) {
  const style = ((format as { style?: MatrixStyle } | undefined)?.style ?? {}) as MatrixStyle;
  const [open, setOpen] = useState<{ projectId: string; type: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const rows = useFlatRows(widgetApi, [
    'projects.id',
    'projects.title',
    'projects.atRisk',
    'projects.completeness',
    'matrix.evidenceType',
    'matrix.state',
    'matrix.provenance',
    'matrix.evidenceTitle',
    'matrix.capturedAt',
    'matrix.fingerprint',
    'matrix.source',
    'matrix.sampleEvidence',
    'matrix.nextStep',
  ]);
  if (!rows) return null;

  const projects = new Map<string, MatrixProject>();
  for (const r of rows) {
    const id = String(r['projects.id']);
    const p = projects.get(id) ?? {
      title: String(r['projects.title']),
      atRisk: Number(r['projects.atRisk'] ?? 0),
      completeness: Number(r['projects.completeness'] ?? 0),
      cells: new Map<string, Cell>(),
    };
    p.cells.set(String(r['matrix.evidenceType']), {
      state: String(r['matrix.state']),
      provenance: (r['matrix.provenance'] as string | null) ?? null,
      evidenceTitle: (r['matrix.evidenceTitle'] as string | null) ?? null,
      capturedAt: (r['matrix.capturedAt'] as string | null) ?? null,
      fingerprint: (r['matrix.fingerprint'] as string | null) ?? null,
      source: (r['matrix.source'] as string | null) ?? null,
      sample: Boolean(r['matrix.sampleEvidence']),
      nextStep: (r['matrix.nextStep'] as string | null) ?? null,
    });
    projects.set(id, p);
  }

  let ordered = [...projects.entries()];
  if (style.onlyMissing) ordered = ordered.filter(([, p]) => [...p.cells.values()].some((c) => c.state === 'missing'));
  const sortBy = style.sortBy ?? 'atRisk';
  ordered.sort((a, b) =>
    sortBy === 'title'
      ? a[1].title.localeCompare(b[1].title)
      : sortBy === 'completeness'
        ? a[1].completeness - b[1].completeness
        : b[1].atRisk - a[1].atRisk,
  );

  const filterTo = (projectId: string) => {
    const field = widgetApi.getSchema().flatMap((t) => t.fields.map((f) => ({ t, f }))).find(({ t, f }) => f.fieldId === 'projects.id' || `${t.id}.${f.fieldId}` === 'projects.id')?.f;
    if (field) widgetApi.toggleCrossFilter({ type: 'value', field, value: projectId, group: 0 });
  };

  const openCell = open ? projects.get(open.projectId)?.cells.get(open.type) : undefined;

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'auto', padding: '4px 8px', fontSize: 12 }} onClick={() => setOpen(null)}>
      {ordered.length === 0 ? (
        <p style={{ color: '#4a5568', padding: 12 }}>No project is missing evidence.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontWeight: 600 }}>Project</th>
              {EVIDENCE_ORDER.map((t) => (
                <th key={t} style={{ fontWeight: 600, fontSize: 11, color: '#4a5568' }}>
                  {t}
                </th>
              ))}
              <th style={{ fontWeight: 600 }}>At risk</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(([id, p]) => (
              <tr key={id}>
                <td
                  style={{ whiteSpace: 'nowrap', paddingRight: 8, cursor: 'pointer', textDecoration: 'underline dotted' }}
                  title="Filter the page to this project (click again to clear)"
                  onClick={(e) => {
                    e.stopPropagation();
                    filterTo(id);
                  }}
                >
                  {p.title}
                </td>
                {EVIDENCE_ORDER.map((t) => {
                  const cell = p.cells.get(t);
                  const state = cell?.state ?? 'not_yet';
                  const bg =
                    state === 'present' ? (PROVENANCE_COLOUR[cell?.provenance ?? ''] ?? '#0a7d3b') : state === 'missing' ? '#c53030' : '#e2e8f0';
                  const selected = open?.projectId === id && open.type === t;
                  return (
                    <td
                      key={t}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(selected ? null : { projectId: id, type: t });
                      }}
                      style={{
                        background: bg,
                        color: state === 'not_yet' ? '#718096' : 'white',
                        textAlign: 'center',
                        borderRadius: 4,
                        padding: '6px 4px',
                        fontSize: 11,
                        cursor: 'pointer',
                        outline: selected ? '2px solid #001c64' : undefined,
                      }}
                    >
                      {state === 'present' ? '✓' : state === 'missing' ? 'missing' : '–'}
                    </td>
                  );
                })}
                <td style={{ textAlign: 'right', fontWeight: p.atRisk > 0 ? 700 : 400, color: p.atRisk > 0 ? '#c53030' : '#4a5568' }}>
                  ${p.atRisk.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {style.showLegend !== false && <Legend />}
      {open && <CellCard projectId={open.projectId} type={open.type} projectTitle={projects.get(open.projectId)?.title ?? ''} cell={openCell} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CellCard({ projectId, projectTitle, type, cell, onClose }: { projectId: string; projectTitle: string; type: string; cell?: Cell; onClose: () => void }) {
  const state = cell?.state ?? 'not_yet';
  return (
    <div
      role="dialog"
      aria-label={`${type} for ${projectTitle}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 12,
        top: 12,
        width: 300,
        background: 'white',
        border: '1px solid #dbe1e8',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,20,53,0.18)',
        padding: 14,
        zIndex: 10,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ color: '#001c64' }}>{type}</strong>
        <button onClick={onClose} aria-label="Close" style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 14 }}>
          ×
        </button>
      </div>
      <div style={{ color: '#545d68' }}>{projectTitle}</div>
      {state === 'present' && cell ? (
        <>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ background: PROVENANCE_COLOUR[cell.provenance ?? ''] ?? '#4a5568', color: 'white', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
              {cell.provenance}
            </span>
            {cell.sample && <span style={{ background: '#e2e8f0', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>Sample</span>}
          </div>
          <div style={{ marginTop: 6 }}>{cell.evidenceTitle}</div>
          <div style={{ color: '#545d68' }}>
            Captured {cell.capturedAt ? new Date(cell.capturedAt).toLocaleString() : '—'} · source {cell.source ?? '—'}
          </div>
          <div style={{ color: '#545d68' }}>
            sha256 <code>{cell.fingerprint}…</code>
          </div>
        </>
      ) : state === 'missing' ? (
        <>
          <div style={{ marginTop: 8, color: '#c53030', fontWeight: 700 }}>Missing</div>
          <div style={{ marginTop: 4 }}>{cell?.nextStep ?? 'Add this evidence.'}</div>
        </>
      ) : (
        <div style={{ marginTop: 8, color: '#545d68' }}>Not required yet at this project’s stage.</div>
      )}
      <a href={`/projects/${projectId}`} style={{ display: 'inline-block', marginTop: 10, color: '#0070e0', fontWeight: 600 }}>
        Open project →
      </a>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    ['System verified', PROVENANCE_COLOUR['System verified']],
    ['Client confirmed', PROVENANCE_COLOUR['Client confirmed']],
    ['Self reported', PROVENANCE_COLOUR['Self reported']],
    ['Missing', '#c53030'],
    ['Not yet needed', '#e2e8f0'],
  ];
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, color: '#4a5568', fontSize: 11 }}>
      {items.map(([label, colour]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: colour, display: 'inline-block' }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// --- Evidence Timeline -------------------------------------------------------------------

function EvidenceTimeline({ widgetApi }: AgWidgetParams) {
  const rows = useFlatRows(widgetApi, ['projects.title', 'evidence.title', 'evidence.type', 'evidence.provenance', 'evidence.capturedAt']);
  if (!rows) return null;

  const times = rows.map((r) => Date.parse(String(r['evidence.capturedAt']))).filter(Number.isFinite);
  const min = Math.min(...times);
  const max = Math.max(...times, min + 86_400_000);
  const lanes = [...new Set(rows.map((r) => String(r['projects.title'])))];
  const x = (t: number) => 2 + ((t - min) / (max - min)) * 96;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '4px 8px', fontSize: 12 }}>
      {lanes.map((lane) => (
        <div key={lane} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', alignItems: 'center', height: 30 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{lane}</div>
          <div style={{ position: 'relative', height: 2, background: '#e2e8f0' }}>
            {rows
              .filter((r) => String(r['projects.title']) === lane)
              .map((r, i) => {
                const t = Date.parse(String(r['evidence.capturedAt']));
                const provenance = String(r['evidence.provenance']);
                const colour = PROVENANCE_COLOUR[provenance] ?? '#4a5568';
                return (
                  <span
                    key={i}
                    title={`${r['evidence.type']}: ${r['evidence.title']}\n${provenance} · ${new Date(t).toLocaleString()}`}
                    style={{
                      position: 'absolute',
                      left: `${x(t)}%`,
                      top: -6,
                      width: 14,
                      height: 14,
                      marginLeft: -7,
                      background: colour,
                      borderRadius: provenance === 'System verified' ? 2 : provenance === 'Client confirmed' ? 7 : 0,
                      transform: provenance === 'Self reported' ? 'rotate(45deg) scale(0.8)' : undefined,
                      border: '2px solid white',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
                    }}
                  />
                );
              })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: 210, color: '#718096', fontSize: 11, marginTop: 4 }}>
        <span>{new Date(min).toLocaleDateString()}</span>
        <span>{new Date(max).toLocaleDateString()}</span>
      </div>
      <Legend />
    </div>
  );
}

// --- Registration ------------------------------------------------------------------------

const widgetDefinitions = [
  {
    id: 'evidence-matrix',
    label: 'Evidence matrix',
    comp: EvidenceMatrix,
    form: (params: { createDefaults: (p: object) => { items: { items: unknown[] }[] } }) => {
      const form = params.createDefaults({});
      form.items[0].items.push({
        type: 'section',
        key: 'proofline-matrix',
        label: 'Matrix',
        items: [
          { type: 'toggle', id: 'format.style.onlyMissing', label: 'Only projects missing evidence', defaultValue: false },
          {
            type: 'select',
            id: 'format.style.sortBy',
            label: 'Sort rows by',
            defaultValue: 'atRisk',
            options: [
              { value: 'atRisk', label: 'Money at risk' },
              { value: 'completeness', label: 'Completeness (lowest first)' },
              { value: 'title', label: 'Project name' },
            ],
          },
          { type: 'toggle', id: 'format.style.showLegend', label: 'Show legend', defaultValue: true },
        ],
      });
      return form;
    },
    defaultSize: { width: 16, height: 20 },
    minSize: { width: 10, height: 10 },
    ai: {
      label: 'Evidence matrix',
      description: 'Grid of projects (rows) by required evidence type (columns). Each cell is present (coloured by provenance), missing (red) or not yet needed (grey). Shows the money at risk per project.',
      usage: 'Use to show which paid projects could not prove fulfilment today. Takes no field configuration; it follows page filters.',
      configuration:
        'Set options in the widget state under format.style: onlyMissing (boolean, default false) hides projects with nothing missing; ' +
        "sortBy ('atRisk' | 'completeness' | 'title', default 'atRisk') orders rows by money at risk, lowest completeness first, or name; " +
        'showLegend (boolean, default true). Example: { "format": { "style": { "onlyMissing": true, "sortBy": "completeness" } } }.',
    },
  },
  {
    id: 'evidence-timeline',
    label: 'Evidence timeline',
    comp: EvidenceTimeline,
    form: (params: { createDefaults: (p: object) => unknown }) => params.createDefaults({}),
    defaultSize: { width: 24, height: 18 },
    minSize: { width: 12, height: 10 },
    ai: {
      label: 'Evidence timeline',
      description: 'One lane per project with a marker for every evidence item at the time it was captured, shaped and coloured by provenance.',
      usage: 'Use to show when proof was collected relative to payment and delivery. Takes no field configuration; it follows page filters.',
    },
  },
];

// Passed to <AgStudio widgets={...}>: Studio's own widgets plus ours in a "Proofline" menu group.
export const prooflineWidgets = (defaults: { menu: { label: string; widgetIds: readonly string[] }[] }) =>
  createWidgets<never>({
    additionalTypes: widgetDefinitions,
    menu: [...defaults.menu, { label: 'Proofline', widgetIds: widgetDefinitions.map((w) => w.id) }],
  } as never);

// The AG Studio AI assistant: one Proofline agent that answers from the evidence ledger and edits
// the page itself. The adapter (./chat-adapter.ts) sends every turn to this app's proxy at
// app/api/ai/chat, which picks the provider and holds the key on the server.
//
// Why one agent instead of Studio's five (lead, data, page, planning, widget): Studio's lead agent
// cannot read data, so every evidence question became a hand-off to a sub-agent plus a closing
// `complete_task` turn - two to three times the model calls on a free-tier quota, and a child run
// that Stop has to reach through its parent. Here a question is one run: fetch, then answer.
// Trade-off: no multi-widget "build me a whole page" planning; single widgets still work.
//
// Why `get_evidence_posture` instead of Studio's `execute_query`: execute_query's schema (and the
// filter tools', which share its filter grammar) is ~20 KB each and Gemini bills it as ~34,000
// input tokens per turn. Three such tools exhausted the free tier's 250,000 tokens/minute inside a
// single question (measured 11 Nov), and Flash-Lite often wrote queries Studio rejected. The
// ledger is small, so one tool returning the whole posture is cheaper, exact and always valid.

import {
  createAiHarness,
  directLlmRunner,
  type AgAiAgentContext,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgAiTelemetryEvent,
  type AgAiTelemetryObserver,
  type AgAiTool,
  type AgStudioApi,
} from 'ag-studio';
import type { ProoflineData } from '@/lib/store';
import { chatAdapter } from './chat-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Summarise evidence posture',
    prompt: 'Summarise this page: how much paid work is missing evidence, which projects, and what is missing.',
  },
  {
    label: 'Paid projects missing evidence',
    prompt: 'Which paid projects are missing evidence, and what is the next step for each?',
  },
  {
    label: 'Missing client acknowledgment',
    prompt: 'Show the projects that are missing a client acknowledgment.',
  },
];

// The evidence matrix on the Evidence posture page (./initial-report.ts) and its custom type
// (./widgets.tsx). Proofline's own widget types take no field mapping.
const MATRIX = { widgetId: 'matrix', pageId: 'posture' };
const CUSTOM_TYPES = new Set(['evidence-matrix', 'evidence-timeline']);

type WidgetLike = { type?: string; dataMapping?: Record<string, unknown>; format?: unknown };

/**
 * Widgets on the selected page that were placed but never configured (no data mapping, no format):
 * what `add_widget` leaves behind. Each gets its own configure tool on the next turn, so the agent
 * can finish a widget it just placed without handing off to Studio's widget agent.
 */
function unconfiguredWidgets(api: AgStudioApi): { id: string; type: string }[] {
  const state = api.getState();
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  return Object.entries(page?.widgets ?? {}).flatMap(([id, raw]) => {
    const w = raw as WidgetLike | undefined;
    if (!w?.type || CUSTOM_TYPES.has(w.type)) return [];
    const mapped = Object.values(w.dataMapping ?? {}).some((v) => (Array.isArray(v) ? v.length > 0 : v != null));
    return mapped || w.format ? [] : [{ id, type: w.type }];
  });
}

// Widgets the assistant placed in this session, newest last. Their configure tools stay listed so a
// follow-up ("make it a pie", "sort it descending") works after the first configuration. Capped:
// each configure tool's schema costs Gemini about 10,000 input tokens per turn.
const placedByAi: string[] = [];
const MAX_PLACED = 2;

function configurableWidgets(api: AgStudioApi): { id: string; type: string }[] {
  for (const { id } of unconfiguredWidgets(api)) {
    if (placedByAi.includes(id)) continue;
    placedByAi.push(id);
    if (placedByAi.length > MAX_PLACED) placedByAi.shift();
  }
  const state = api.getState();
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  return placedByAi.flatMap((id) => {
    const w = page?.widgets?.[id] as WidgetLike | undefined;
    return w?.type ? [{ id, type: w.type }] : [];
  });
}

const toolName = (widgetId: string) => `configure_widget_${widgetId.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 64);

// Evidence rows sent to the model at most; the demo ledger has about 30.
const MAX_EVIDENCE_ROWS = 200;

// The dashboard's current data. Studio's harness is built once, so the dashboard hands every new
// data set here (dashboard.tsx, after each render with new data) and the tool reads it per call.
let currentData: ProoflineData | undefined;
export const setAiData = (data: ProoflineData) => {
  currentData = data;
};

/**
 * The whole evidence posture in one call: totals, every project with what it is missing and the
 * next step, and every evidence item. Read from the same data the dashboard shows, so the answer
 * and the widgets agree; computed by code, so the model only phrases it.
 */
function postureTool(api: AgStudioApi): AgAiTool {
  return api.defineAiTool({
    name: 'get_evidence_posture',
    description:
      'Returns the seller\'s whole evidence ledger as JSON: totals (paid, at risk, missing items, coverage), every project ' +
      '(status, posture, paid, at risk, missing evidence with the next step for each) and every evidence item ' +
      '(type, provenance, source, date, sample flag). Call it once per question before answering; it ignores page filters.',
    params: (s) => s.object({}),
    execute: (_args, ctx) => {
      const data = currentData;
      if (!data) return ctx.error('The evidence data has not loaded yet. Try again in a moment.');
      const titles = new Map(data.projects.map((p) => [p.id, p.title]));
      const required = data.matrix.reduce((n, r) => n + r.required, 0);
      const present = data.matrix.reduce((n, r) => n + r.presentRequired, 0);
      const money = (n: number) => Math.round(n * 100) / 100;
      const evidence = data.evidence.slice(0, MAX_EVIDENCE_ROWS);
      const posture = {
        asOf: data.asOf,
        currency: 'USD',
        totals: {
          projects: data.projects.length,
          paid: money(data.projects.reduce((n, p) => n + p.paidAmount, 0)),
          atRisk: money(data.projects.reduce((n, p) => n + p.atRisk, 0)),
          missingItems: data.gaps.length,
          evidenceCoveragePercent: required ? Math.round((present / required) * 100) : 100,
        },
        projects: data.projects.map((p) => ({
          title: p.title,
          client: p.client,
          status: p.status,
          posture: p.posture,
          paid: money(p.paidAmount),
          atRisk: money(p.atRisk),
          completenessPercent: Math.round(p.completeness * 100),
          evidenceItems: p.evidenceItems,
          missing: data.gaps.filter((g) => g.projectId === p.id).map((g) => ({ evidence: g.missing, nextStep: g.nextStep })),
          sample: p.sample,
        })),
        evidence: evidence.map((e) => ({
          project: titles.get(e.projectId) ?? e.projectId,
          type: e.type,
          title: e.title,
          provenance: e.provenance,
          source: e.source,
          captured: e.capturedDate,
          sample: e.sample,
        })),
        ...(data.evidence.length > evidence.length && { evidenceTruncated: `${data.evidence.length - evidence.length} more items not shown` }),
      };
      return ctx.success(JSON.stringify(posture));
    },
  });
}

type MatrixStyle = { onlyMissing?: boolean; sortBy?: 'atRisk' | 'completeness' | 'title'; showLegend?: boolean };

/**
 * Sets the evidence matrix's display options (the same keys as its "Matrix" section in the edit
 * panel, read by ./widgets.tsx). Studio's generic configure_widget can't: a custom widget without a
 * `formatShape` is advertised to the AI with no format at all, and Studio rejected
 * format.style with "Expected undefined" (11 Nov). Applied with setState, so Undo reverts it.
 */
function matrixOptionsTool(api: AgStudioApi): AgAiTool {
  return api.defineAiTool({
    name: 'set_evidence_matrix_options',
    description:
      'Change how the evidence matrix on the Evidence posture page displays. onlyMissing=true hides projects with nothing missing; ' +
      'sortBy orders rows by money at risk ("atRisk", default), lowest completeness first ("completeness") or name ("title"); ' +
      'showLegend shows or hides the colour legend. Pass only the options to change.',
    params: (s) =>
      s.object({
        onlyMissing: s.boolean().optional(),
        sortBy: s.enum(['atRisk', 'completeness', 'title'] as const).optional(),
        showLegend: s.boolean().optional(),
      }),
    execute: (args, ctx) => {
      const state = api.getState();
      const page = state.pages.find((p) => p.id === MATRIX.pageId);
      const widget = page?.widgets?.[MATRIX.widgetId] as (WidgetLike & { format?: { style?: MatrixStyle } }) | undefined;
      if (!page || !widget) return ctx.error('The evidence matrix is not on the Evidence posture page any more.');
      const changes = Object.fromEntries(Object.entries(args as MatrixStyle).filter(([, v]) => v !== undefined)) as MatrixStyle;
      if (Object.keys(changes).length === 0) return ctx.error('Pass at least one of onlyMissing, sortBy, showLegend.');
      const style: MatrixStyle = { ...widget.format?.style, ...changes };
      const updated = { ...widget, format: { ...widget.format, style } };
      api.setState({
        ...state,
        pages: state.pages.map((p) => (p.id === page.id ? { ...p, widgets: { ...p.widgets, [MATRIX.widgetId]: updated } } : p)),
      } as typeof state);
      const where = state.selectedPageId === page.id ? '' : ' (on the Evidence posture page, which the user is not looking at)';
      return ctx.success(`Evidence matrix options are now ${JSON.stringify(style)}${where}.`);
    },
  });
}

/**
 * Studio's configure_widget, bound to one widget, with `widgetId` and `op` filled in by code instead
 * of the model. Flash-Lite kept omitting `widgetId` (Studio rejected both calls with "Expected one
 * of: <widget ids>", 11 Nov), and the binding already says which widget it is. Keys the model puts
 * beside `value` (dataMapping, format, sort) are moved into it.
 */
const BOUND_KEYS = ['widgetId', 'op'];
const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

function configureTool(studio: AgAiAgentContext['studio'], widgetId: string, type: string): AgAiTool {
  const tool = studio.configureWidget(
    { widgetType: type, widgetId },
    { name: toolName(widgetId), description: `Configure the ${type} widget "${widgetId}" on this page: pass "value" with its dataMapping, format (including format.title) and sort.` },
  );
  return {
    name: tool.name,
    description: tool.description,
    kind: tool.kind,
    schema: () => {
      const schema = tool.schema();
      if (!schema) return schema;
      const params = schema.parameters as { properties?: Record<string, unknown>; required?: string[] };
      const properties = omit(params.properties ?? {}, BOUND_KEYS);
      const required = (params.required ?? []).filter((k) => !BOUND_KEYS.includes(k));
      return { ...schema, parameters: { ...params, properties, required } as typeof schema.parameters };
    },
    execute: (call, ctx) => {
      const { value, ...rest } = call.args as { value?: Record<string, unknown> } & Record<string, unknown>;
      return tool.execute!({ ...call, args: { widgetId, op: 'patch', value: { ...value, ...omit(rest, BOUND_KEYS) } } }, ctx);
    },
  };
}

function tools({ api, studio }: AgAiAgentContext, own: AgAiTool[]): AgAiTool[] {
  return [
    ...own,
    studio.viewSchema(),
    studio.viewReport(),
    studio.viewPage(),
    studio.viewWidget(),
    studio.addWidget(),
    studio.positionWidget(),
    studio.removeWidget(),
    ...configurableWidgets(api).map(({ id, type }) => configureTool(studio, id, type)),
  ];
}

/** Tables and their exact field ids, so most questions need no `view_schema` round trip. */
function dataOverview(api: AgStudioApi): string {
  const schema = api.getAiContext().schema();
  return schema.tables
    .map((table) => {
      const fields = table.fields
        .map((f) => `- ${f.fieldId}: ${f.name} (${f.dataType}${f.kind === 'column' ? '' : `, ${f.kind}`})`)
        .join('\n');
      return `### ${table.id}${table.description ? `: ${table.description}` : ''}\n${fields}`;
    })
    .join('\n\n');
}

function pageOverview(api: AgStudioApi): string {
  const state = api.getState();
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  const layout = page?.widgetLayout ?? {};
  const widgets = Object.entries(page?.widgets ?? {}).map(([id, raw]) => {
    const w = raw as WidgetLike & { format?: { title?: { text?: string } } };
    const at = layout[id];
    const where = at ? ` at x${at.xTrack} y${at.yTrack} w${at.xSpan} h${at.ySpan}` : '';
    return `- ${id} (${w?.type ?? '?'})${where}${w?.format?.title?.text ? `: "${w.format.title.text}"` : ''}`;
  });
  const columns = page?.layout?.columns ?? 24;
  const freeRow = Math.max(0, ...Object.values(layout).map((l) => (l ? l.yTrack + l.ySpan : 0)));
  return (
    `The user is looking at page "${state.selectedPageId}" (grid ${columns} columns wide). Widgets on it:\n${widgets.join('\n') || '- none'}\n` +
    `Free space starts at row ${freeRow}: place a new widget at xTrack 0, yTrack ${freeRow} (full width ${columns}, or half ${columns / 2}), ` +
    `ySpan about 20, so it never overlaps an existing widget.`
  );
}

function widgetTypes(api: AgStudioApi): string {
  return api
    .getAiContext()
    .catalogue()
    .map((e) => `- ${e.type}: ${e.description.split('\n')[0]}`)
    .join('\n');
}

function instructions({ api }: AgAiAgentContext): string {
  const configure = unconfiguredWidgets(api);
  const guidance = configure
    .map(({ id, type }) => {
      const entry = api.getAiContext().catalogue().find((e) => e.type === type);
      return `### ${toolName(id)} (${type})\n${entry?.configuration ?? entry?.usage ?? ''}`;
    })
    .join('\n\n');

  return `You are the Proofline assistant inside the seller's evidence dashboard. Proofline tracks
fulfilment evidence for a freelancer who sells digital work and services through PayPal: for each
client project, what the seller could show PayPal if a payment were held, the account reviewed or a
dispute opened.

## How to answer
- Answer from the data, never from memory: call get_evidence_posture first (once per question),
  then answer from its JSON. Every number, name and next step you write must come from it.
- Keep answers short: a one-line summary, then bullets. Name projects by title, never by id.
- Money is USD; write it like $1,250.00. Percentages to whole numbers.
- Rows where Sample is true are seeded demo data; say so when you list them.
- Do not write @field[...], @widget[...] or @table[...] references in answers; use plain names.
- Only say a change was made if its tool returned success. If a tool failed, say so in one
  sentence with the reason it gave; do not retry the same failing call.
- Do not suggest features the dashboard lacks (trend lines, drill-down, period comparisons).

## Domain
- "At risk" = paid amount on projects that are missing required evidence.
- Evidence provenance, strongest first: system_verified (from PayPal or the delivery portal),
  client_confirmed (the client acknowledged it), self_reported (uploaded by the seller).
- The matrix table has one row per project and evidence type; state is present, missing (required
  now) or not_yet (not required at this project's stage). The gaps table lists each missing item
  with the next step to close it.

## Current page
${pageOverview(api)}

## Changing the dashboard (only when the user asks)
- You cannot filter the dashboard. If asked, answer in text and say the user can filter from the
  Filters panel.
- Evidence matrix display (only missing, sort order, legend): set_evidence_matrix_options. You do
  not need get_evidence_posture for this.
- Add a widget: add_widget places an EMPTY widget (pick a widgetId like "w-evidence-by-type") in
  the free space given above. On your next turn a tool named configure_widget_<widgetId> appears:
  call it once with the data mapping and a plain-language title. It stays available for that widget
  afterwards, for follow-up changes. One widget at a time. If you cannot configure a widget you
  placed after two attempts, remove it with remove_widget and tell the user it failed.
  Then answer; do not call view_page or view_schema unless a tool reported a problem.
- Move or resize: position_widget. Remove: remove_widget (only when asked).

## Widget types
${widgetTypes(api)}
${
  configure.length
    ? `\n## Configuring the widget you placed\nUse these exact field ids in the data mapping. Measures and calculated fields are pre-aggregated: use them without an aggregation.\n\n${dataOverview(api)}\n\n${guidance}`
    : ''
}`;
}

// Studio's own account of every run: which turn ran which tool, whether it succeeded and why not,
// and how the run ended (ok / error / cancelled). Logged with console.log because the Next.js dev
// log records browser `log` and `error` lines.
const studioTrace: AgAiTelemetryObserver = {
  onEvent(event: AgAiTelemetryEvent) {
    const t = event.trace as { agentId?: string; turnIndex?: number };
    const who = `${t.agentId ?? '?'}${t.turnIndex === undefined ? '' : ` turn ${t.turnIndex}`}`;
    switch (event.type) {
      case 'run_started':
        console.log('[Studio AI]', who, 'run started');
        break;
      case 'run_finished':
        (event.status === 'error' ? console.error : console.log)('[Studio AI]', who, 'run finished:', event.status, event.error ?? '');
        break;
      case 'turn_finished':
        if (event.error) console.error('[Studio AI]', who, 'turn error:', event.error);
        break;
      case 'tool_execution_started':
        console.log('[Studio AI]', who, 'tool start:', event.name);
        break;
      case 'tool_execution_finished': {
        const e = event as typeof event & { ok?: boolean; issues?: { message: string }[] };
        (e.ok === false ? console.error : console.log)(
          '[Studio AI]', who, 'tool done:', event.name, e.ok === false ? `FAILED ${JSON.stringify(e.issues ?? []).slice(0, 300)}` : 'ok',
        );
        break;
      }
    }
  },
};

export function buildAi(): AgAiHarnessSetup {
  const adapter = chatAdapter({ endpoint: '/api/ai' });
  return ({ api }) => {
    const own = [postureTool(api), matrixOptionsTool(api)];
    return createAiHarness(api, () => ({
      agents: [
        directLlmRunner({
          id: 'proofline',
          name: 'Proofline assistant',
          adapter,
          // A question takes 2 rounds (fetch, answer); adding a widget about 4. This only stops a
          // run that never settles.
          maxTurns: 8,
          instructions,
          tools: (ctx) => tools(ctx, own),
        }),
      ],
      primary: 'proofline',
      promptStarters: PROMPT_STARTERS,
      observers: [studioTrace],
    }));
  };
}

import { notify } from '@modeler/app/noticeStore';
import { useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { surface, radius } from '@modeler/ui/styles';

const e = {
  list: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 flex-1 min-h-0 overflow-y-auto -mx-1 px-1 content-start',
  empty: 'text-sm text-stone-500 italic py-10 text-center',
  item: `w-full h-full flex flex-col text-left ${radius.card} ${surface.card} border border-black/[0.06] hover:bg-cream-300 hover:border-black/[0.10] disabled:opacity-50 disabled:cursor-not-allowed transition-all p-4 cursor-pointer`,
  itemHeader: 'flex flex-col gap-0.5',
  itemTitle: 'font-semibold tracking-tight text-stone-900',
  itemFilename: 'font-mono text-[11px] text-stone-500 shrink-0',
  itemDescription: 'text-[13px] leading-relaxed text-stone-600 mt-1 line-clamp-3',
  itemBusy: 'text-xs text-stone-500 mt-1',
} as const;

type Template = {
  id: string;
  title: string;
  category: string;
  description: string;
  hint?: string;
  filename?: string;
};

const TEMPLATES: Template[] = [
  {
    id: 'blank',
    title: 'Empty diagram',
    category: 'Blank',
    description:
      'A bare canvas with a single start event. Build the flow from scratch with the element palette.',
  },
  {
    id: 'consort2025.studyflow.png',
    filename: 'consort2025.studyflow.png',
    title: 'Randomized controlled trial',
    category: 'Clinical trial',
    description:
      'A CONSORT 2025-compliant parallel-group RCT: enrollment, eligibility screening, randomized allocation to two arms, follow-up, and analysis, with exclusion paths modeled as error events.',
  },
  {
    id: 'cognitive_battery.studyflow.png',
    filename: 'cognitive_battery.studyflow.png',
    title: 'Within-subject cognitive battery',
    category: 'Cognitive',
    description:
      'A single-session battery in which every participant completes all four Behaverse tasks (N-Back, Digit Span, SART, Which One) in a counterbalanced order, followed by a post-battery survey.',
  },
  {
    id: 'spirit2025.studyflow.png',
    filename: 'spirit2025.studyflow.png',
    title: 'Multi-session longitudinal study',
    category: 'Longitudinal',
    description:
      'A SPIRIT 2025 trial protocol scheduling screening, baseline, intervention/control arms, and follow-up visits across 24 weeks, with per-visit timing that populates the Gantt view.',
    hint: 'Try View As → Gantt or Checklist',
  },
  {
    id: 'agent_eval_pool.studyflow.png',
    filename: 'agent_eval_pool.studyflow.png',
    title: 'LLM evaluation study',
    category: 'AI evaluation',
    description:
      'An agent actor pool — a random baseline, a Claude LLM, and a local Ollama LLM — each run the same 2-back protocol in parallel, then their responses are aggregated and scored against the baseline.',
  },
];

const templateFiles = import.meta.glob(
  '#assets/examples/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

function urlFor(filename: string): string | undefined {
  const entry = Object.entries(templateFiles).find(([path]) => path.endsWith(`/${filename}`));
  return entry?.[1];
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function TemplateGalleryDialog({ isOpen, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const modeler = useModeler();

  const selectTemplate = async (template: Template) => {
    if (!modeler || busy) return;

    const url = template.filename ? urlFor(template.filename) : undefined;
    if (template.filename && !url) {
      notify('error', `Template not found: ${template.filename}`);
      return;
    }

    setBusy(template.id);
    try {
      if (template.filename && url) {
        const content = await fetch(url).then((r) => r.arrayBuffer());
        await executeCommand(modeler, { type: 'OpenDiagram', filename: template.filename, content });
      } else {
        await executeCommand(modeler, { type: 'NewDiagram' });
      }
      onClose();
    } catch (err: any) {
      notify('error', err?.message || 'Failed to load template.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Diagram"
      size="lg"
    >
            <ul className={e.list}>
              {TEMPLATES.map((template) => {
                const isBusy = busy === template.id;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      data-testid={`new-diagram-${template.id}`}
                      onClick={() => selectTemplate(template)}
                      disabled={!!busy}
                      className={e.item}
                    >
                      <div className={e.itemHeader}>
                        <span className={e.itemFilename}>{template.category}</span>
                        <span className={e.itemTitle}>{template.title}</span>
                      </div>
                      <p className={e.itemDescription}>{template.description}</p>
                      {template.hint && (
                        <p className={e.itemBusy}>{template.hint}</p>
                      )}
                      {isBusy && (
                        <p className={e.itemBusy}>Loading...</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
    </Modal>
  );
}

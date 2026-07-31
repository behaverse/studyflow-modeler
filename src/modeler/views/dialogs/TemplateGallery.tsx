import { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '@/modeler/views/useModeler';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { dialog as d, examplesList as e } from '@/modeler/infra/styles';
import { ICONS } from '@/icons';

/**
 * Curated starting points for the "New" picker. Unlike the raw Examples list
 * (which enumerates every shipped diagram), this is a hand-picked, ordered set
 * with study-design framing. Each file-backed entry points at a shipped
 * example PNG, which imports pre-validated through `open-diagram`.
 *
 * The blank canvas is the first entry rather than a separate command: starting
 * a diagram is one decision ("from what?"), so it is one dialog.
 */
type Template = {
  /** Stable key; the basename in `@/assets/examples/` for file-backed entries. */
  id: string;
  title: string;
  /** Short category chip. */
  category: string;
  description: string;
  /** Optional nudge toward a view/feature that showcases the template. */
  hint?: string;
  /** Omitted by the blank entry, which dispatches `new-diagram` instead. */
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
  '@/assets/examples/*.png',
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
      alert(`Template not found: ${template.filename}`);
      return;
    }

    setBusy(template.id);
    try {
      if (template.filename && url) {
        // An example is a PNG with its studyflow inside it, so it travels as bytes.
        const content = await fetch(url).then((r) => r.arrayBuffer());
        await executeCommand(modeler, { type: 'open-diagram', filename: template.filename, content });
      } else {
        await executeCommand(modeler, { type: 'new-diagram' });
      }
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Failed to load template.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel className={`${d.panelLg} ${d.panel}`}>
            <DialogTitle as="h3" className={`${d.title} pb-3`}>
              New Diagram
              <span className={d.closeButton} onClick={onClose}>
                <i className={ICONS.close}></i>
              </span>
            </DialogTitle>
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
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

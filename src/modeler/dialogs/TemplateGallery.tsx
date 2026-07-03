import { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '../useModeler';
import { executeCommand } from '../commands';
import { dialog as d, examplesList as e } from '../styles';

/**
 * Curated starting points for the "New from Template" picker. Unlike the raw
 * Examples list (which enumerates every shipped diagram), this is a hand-picked,
 * ordered set with study-design framing. Each entry points at a shipped
 * `.studyflow` file that imports pre-validated through `open-diagram`.
 */
type Template = {
  /** Basename in `@/assets/examples/`. */
  filename: string;
  title: string;
  /** Short category chip. */
  category: string;
  description: string;
  /** Optional nudge toward a view/feature that showcases the template. */
  hint?: string;
};

const TEMPLATES: Template[] = [
  {
    filename: 'consort2025.studyflow',
    title: 'Randomized controlled trial',
    category: 'Clinical trial',
    description:
      'A CONSORT 2025-compliant parallel-group RCT: enrollment, eligibility screening, randomized allocation to two arms, follow-up, and analysis, with exclusion paths modeled as error events.',
  },
  {
    filename: 'cognitive_battery.studyflow',
    title: 'Within-subject cognitive battery',
    category: 'Cognitive',
    description:
      'A single-session battery in which every participant completes all four Behaverse tasks (N-Back, Digit Span, SART, Which One) in a counterbalanced order, followed by a post-battery survey.',
  },
  {
    filename: 'spirit2025.studyflow',
    title: 'Multi-session longitudinal study',
    category: 'Longitudinal',
    description:
      'A SPIRIT 2025 trial protocol scheduling screening, baseline, intervention/control arms, and follow-up visits across 24 weeks, with per-visit timing that populates the Gantt view.',
    hint: 'Try View As → Gantt or Checklist',
  },
  {
    filename: 'agent_eval_pool.studyflow',
    title: 'LLM evaluation study',
    category: 'AI evaluation',
    description:
      'An agent actor pool — a random baseline, a Claude LLM, and a local Ollama LLM — each run the same 2-back protocol in parallel, then their responses are aggregated and scored against the baseline.',
  },
];

const templateFiles = import.meta.glob(
  '@/assets/examples/*.studyflow',
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
    const url = urlFor(template.filename);
    if (!url) {
      alert(`Template not found: ${template.filename}`);
      return;
    }
    setBusy(template.filename);
    try {
      const content = await fetch(url).then((r) => r.text());
      await executeCommand(modeler, {
        type: 'open-diagram',
        filename: template.filename,
        content,
      });
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
              New from Template
              <span className={d.closeButton} onClick={onClose}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <p className={`${d.body} pb-5`}>
              Start from a pre-validated study design. Your current diagram will be replaced.
            </p>
            <ul className={e.list}>
              {TEMPLATES.map((template) => {
                const isBusy = busy === template.filename;
                return (
                  <li key={template.filename}>
                    <button
                      type="button"
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

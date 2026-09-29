/**
 * The canvas's keys and clipboard: shortcuts (select all, undo and redo, zoom, duplicate, delete, nudge, edit a name,
 * the append menu) and copy, cut and paste as `.studyflow.yaml` text. Each writes through the study.
 */
import type { Canvas } from '@canvas/Canvas.ts';
import type { GestureTools } from '@canvas/interaction/gestures.ts';
import type { Point } from '@canvas/study/scene.ts';
import type { StudyResult } from '@canvas/study/Study.ts';

const NUDGE = 1;
const LARGE_NUDGE = 10;

/** Whether typing lands in a text field rather than on the canvas. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class Keys {
  private readonly canvas: Canvas;
  private readonly tools: GestureTools;

  constructor(canvas: Canvas, tools: GestureTools) {
    this.canvas = canvas;
    this.tools = tools;
  }

  shortcut(ev: KeyboardEvent): void {
    const canvas = this.canvas;
    if (ev.defaultPrevented || this.tools.labelEditing.isActive() || isTextEntry(ev.target) || ev.altKey) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const editable = this.tools.editable();
    let handled = false;
    if (mod) {
      switch (ev.key) {
        case 'a': case 'A': handled = canvas.selectAll(); break;
        case 'z': case 'Z': handled = editable && (ev.shiftKey ? canvas.study.redo() : canvas.study.undo()).ok; break;
        case '=': case '+': canvas.zoom('in'); handled = true; break;
        case '-': case '_': canvas.zoom('out'); handled = true; break;
        case '0': canvas.zoom(1); handled = true; break;
        case 'd': case 'D': handled = editable && this.duplicate(); break;
        default: break;
      }
    } else if (editable) {
      const step = ev.shiftKey ? LARGE_NUDGE : NUDGE;
      switch (ev.key) {
        case 'Delete': case 'Backspace': {
          const { changed, removed } = canvas.deleteSelection();
          handled = changed.length + removed.length > 0;
          break;
        }
        case 'ArrowLeft': handled = this.tools.nudgeSelection(-step, 0); break;
        case 'ArrowRight': handled = this.tools.nudgeSelection(step, 0); break;
        case 'ArrowUp': handled = this.tools.nudgeSelection(0, -step); break;
        case 'ArrowDown': handled = this.tools.nudgeSelection(0, step); break;
        case 'e': handled = canvas.editLabel(); break;
        case 'a': {
          const elements = this.tools.selection.get();
          if (elements.length === 0) break;
          this.tools.appendMenu(elements.map((element) => element.id));
          handled = true;
          break;
        }
        default: break;
      }
    }
    if (handled) ev.preventDefault();
  }

  /**
   * Copy and cut put the selection on the clipboard as `.studyflow.yaml` text (`study.copy`); paste draws what the
   * clipboard holds under the pointer, or in the middle of the view, and selects it.
   */
  clipboard(ev: ClipboardEvent, pointer: Point | undefined): void {
    const data = ev.clipboardData;
    if (!data || ev.defaultPrevented || this.tools.labelEditing.isActive() || isTextEntry(ev.target)) return;
    const study = this.canvas.study;
    if (ev.type === 'paste') {
      if (!this.tools.editable()) return;
      const at = pointer ? this.tools.viewport.toDiagram(pointer) : this.tools.viewportCentre();
      if (!this.selectPasted(study.paste({ yaml: data.getData('text/plain'), at }))) return;
    } else {
      const copied = study.copy({ ids: this.tools.selection.get().map((element) => element.id) });
      if (!copied.ok) return;
      data.setData('text/plain', copied.yaml);
      if (ev.type === 'cut' && this.tools.editable()) this.canvas.deleteSelection();
    }
    ev.preventDefault();
  }

  /** `Ctrl`/`Cmd`+D: a copy of the selection a step right of and below it, in what holds it, selected. */
  private duplicate(): boolean {
    const elements = this.tools.selection.get();
    const study = this.canvas.study;
    const copied = study.copy({ ids: elements.map((element) => element.id) });
    if (!copied.ok) return false;
    const holders = new Set(elements.map((element) => element.parent?.id));
    const into = holders.size === 1 ? [...holders][0] : undefined;
    return this.selectPasted(study.paste({ yaml: copied.yaml, ...(into ? { into } : {}) }));
  }

  /** Select the shapes a paste added at its top (what holds the rest); whether it added anything. */
  private selectPasted(result: StudyResult): boolean {
    if (!result.ok) return false;
    const study = this.canvas.study;
    const added = new Set(result.added);
    this.canvas.select(result.added.filter((id) => {
      const record = study.get(id);
      return record?.kind === 'node' && !(record.parent && added.has(record.parent));
    }));
    return true;
  }
}

import { isPastedImage } from '@core/model/pastedImages';
import { notify } from '@modeler/app/noticeStore';
import { keepsPastedImages } from '@modeler/diagram/formats';
import { defaultSaveFormat } from '@modeler/diagram/save';
import type { Editor } from '@modeler/editor/port';

/**
 * Say, as an image lands on the canvas, that the file being worked on will not keep it. Auto-save writes that file
 * without a word, so waiting for a save to say so could be waiting until the image is gone.
 */
export function attachPastedImageNotice(modeler: Editor): () => void {
  const onChanged = ({ added }: { added: readonly string[] }): void => {
    if (keepsPastedImages(defaultSaveFormat()) || !added.some((id) => isPastedImage(modeler.study.element(id)))) return;
    notify('info', 'Only a .studyflow.png keeps a pasted image: use Save As and choose PNG to keep this one.');
  };
  modeler.events.on('ElementsChanged', onChanged);
  return () => modeler.events.off('ElementsChanged', onChanged);
}

import { idOf, isElement, StudyModel, type Element, type Value } from '@core/model/index';

/**
 * An image pasted on a study's canvas: a BPMN text annotation whose `textFormat` says it holds a PNG and whose `text`
 * is the id of the image's bytes. It annotates the drawing and is no part of the protocol, and only a `.studyflow.png`
 * keeps it, its bytes in chunks of their own (`document/png.ts`): every other file is written from {@link withoutPastedImages}.
 */
const FORMAT = 'image/png';

/** The attributes that make a text annotation the pasted image of the bytes named `id`. */
export function pastedImageAttributes(id: string): { text: string; textFormat: string } {
  return { text: id, textFormat: FORMAT };
}

export function isPastedImage(value: Value | undefined): value is Element {
  return isElement(value) && value.type === 'bpmn:TextAnnotation' && value.textFormat === FORMAT;
}

/** The id of a PNG's bytes: the same image pasted twice is one image, and a copy pasted into another study cannot name
 * another image there. */
export async function pastedImageId(png: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', png as BufferSource));
  return `sha256-${Array.from(hash.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** The ids of the bytes the study's pasted images name. */
export function pastedImageIds(model: StudyModel): Set<string> {
  const ids = new Set<string>();
  for (const element of model.elements()) if (isPastedImage(element) && typeof element.text === 'string') ids.add(element.text);
  return ids;
}

/** `model` as every file but a `.studyflow.png` holds it: no pasted image, no association to one, no drawing of either. */
export function withoutPastedImages(model: StudyModel): StudyModel {
  const images = new Set<string>();
  for (const element of model.elements()) if (isPastedImage(element)) images.add(element.id!);
  if (images.size === 0) return model;

  const dropped = new Set(images);
  const goes = (value: Value): boolean => {
    if (isPastedImage(value)) return true;
    if (!isElement(value) || value.type !== 'bpmn:Association') return false;
    const links = images.has(idOf(value.sourceRef) ?? '') || images.has(idOf(value.targetRef) ?? '');
    if (links && value.id) dropped.add(value.id);
    return links;
  };
  const kept = (value: Value): Value => {
    if (Array.isArray(value)) return value.filter((item) => !goes(item)).map(kept);
    if (!isElement(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, kept(item as Value)])) as Element;
  };
  const roots = model.study.roots.map((root) => kept(root) as Element);
  const layout = Object.fromEntries(Object.entries(model.study.layout).filter(([id]) => !dropped.has(id)));
  return new StudyModel({ ...model.study, roots, layout }, model.metamodel);
}

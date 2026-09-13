import { COMPOUND_EXTENSIONS } from '@modeler/export/formats';

/** Compound extensions count as one, read from the export catalog so a new format cannot drift. */
export const filenameStem = (filename: string): string => {
  const lower = filename.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((extension) => lower.endsWith(extension.toLowerCase()));
  if (compound) return filename.slice(0, -compound.length);
  return filename.replace(/\.[^/.]+$/, '');
};

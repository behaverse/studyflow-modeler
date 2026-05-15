import { phq9 } from './phq-9';
import { gad7 } from './gad-7';
import { bdi2 } from './bdi-ii';

export type InstrumentItem = {
  id: string;
  prompt: string;
  scale: { value: number; label: string }[];
};

export type InstrumentDefinition = {
  id: string;
  title: string;
  preamble?: string;
  items: InstrumentItem[];
};

const REGISTRY: Record<string, InstrumentDefinition> = {
  'phq-9': phq9,
  phq9: phq9,
  'gad-7': gad7,
  gad7: gad7,
  'bdi-ii': bdi2,
  'bdi2': bdi2,
};

export function getInstrument(id: string | undefined): InstrumentDefinition | null {
  if (!id) return null;
  const key = id.toLowerCase().trim();
  return REGISTRY[key] ?? null;
}

import { getTypeName, resolveDisplayName } from '@/modeler/models/inspector/elementName';
import { inspector as s } from '@/modeler/infra/styles';

export function Header({ element }: { element: any }) {
  return (
    <>
      <h1 className={s.headerTitle}>{resolveDisplayName(element)}</h1>
      <h2 className={s.headerSubtitle}>{getTypeName(element)}</h2>
    </>
  );
}

import { inspector as s } from '../styles';
import { ICONS } from '@/icons';

interface ToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

export function ToggleButton({ isInspectorVisible, onClick }: ToggleButtonProps) {
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? ICONS.sidebarCollapse : ICONS.sidebarExpand;

  return (
    <button onClick={onClick} className={s.toggleButton} title={title}>
      <i className={`${icon} ${s.toggleIcon}`}></i>
    </button>
  );
}

import { inspector as s } from './styles';

interface ToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

export function ToggleButton({ isInspectorVisible, onClick }: ToggleButtonProps) {
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible
    ? 'iconify tabler--layout-sidebar-right-collapse-filled'
    : 'iconify tabler--layout-sidebar-right-expand-filled';

  return (
    <button onClick={onClick} className={s.toggleButton} title={title}>
      <i className={`${icon} ${s.toggleIcon}`}></i>
    </button>
  );
}

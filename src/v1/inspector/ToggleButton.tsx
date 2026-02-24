
interface ToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

export function ToggleButton({ isInspectorVisible, onClick }: ToggleButtonProps) {

  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? 'iconify tabler--layout-sidebar-right-collapse-filled' : 'iconify tabler--layout-sidebar-right-expand-filled';

  const colors = isInspectorVisible
    ? 'text-white/50 hover:text-white/80 active:text-white'
    : 'text-stone-400 hover:text-stone-600 active:text-stone-800';

  return (
    <button
      onClick={onClick}
      className={`absolute right-2 top-2 m-2 ${colors} rounded-xl z-50`}
      title={title}
    >
      <i className={`${icon} text-[32px]`}></i>
    </button>
  );
}

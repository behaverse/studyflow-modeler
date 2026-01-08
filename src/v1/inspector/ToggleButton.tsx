
interface ToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

export function ToggleButton({ isInspectorVisible, onClick }: ToggleButtonProps) {

  const position = isInspectorVisible ? 'right-4' : 'right-4';
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? 'iconify bi--arrow-bar-right' : 'iconify bi--layout-sidebar-inset-reverse';

  return (
    <button
      onClick={onClick}
      className={`absolute ${position} top-4 hover:text-violet-600 m-2 text-stone-700 rounded-xl z-50`}
      title={title}
    >
      <i className={`${icon} text-[24px]`}></i>
    </button>
  );
}

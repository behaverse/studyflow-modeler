
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
    <button
      onClick={onClick}
      className={`fixed z-60 top-1/2 -translate-y-1/2 flex items-center justify-center
                  w-7 h-14 rounded-l-[12px]
                  bg-white/55 backdrop-blur-2xl border border-white/45 border-r-0
                  shadow-[-2px_0_8px_rgba(0,0,0,0.06),-4px_0_16px_rgba(0,0,0,0.06)]
                  text-stone-500 hover:text-stone-800 transition-colors
                  ${isInspectorVisible ? 'right-[292px]' : 'right-0'}`}
      title={title}
    >
      <i className={`${icon} text-[20px]`}></i>
    </button>
  );
}

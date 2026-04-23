
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
      className="relative z-10 flex items-center justify-center self-start
                  w-7 h-9 rounded-l-[10px]
                  bg-white/55 backdrop-blur-2xl border border-white/45 border-r-0
                  shadow-[-2px_0_8px_rgba(0,0,0,0.06),-4px_0_16px_rgba(0,0,0,0.06)]
                  text-stone-500 hover:text-stone-800 transition-colors"
      title={title}
    >
      <i className={`${icon} text-[20px]`}></i>
    </button>
  );
}

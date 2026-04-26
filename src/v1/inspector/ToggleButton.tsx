
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
                  w-7 h-9 rounded-bl-[10px]
                  bg-stone-800/90 backdrop-blur-2xl border border-white/10 border-r-0
                  text-stone-400 hover:text-white transition-colors"
      title={title}
    >
      <i className={`${icon} text-[20px]`}></i>
    </button>
  );
}

export type CommandContext = {
  modeler?: any;
  modeling?: any;
};

export type CommandResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export function resolveModeling(context: CommandContext): any {
  if (context.modeling) return context.modeling;
  if (context.modeler) return context.modeler.get('modeling');
  return undefined;
}

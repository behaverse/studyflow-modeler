export type CommandResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

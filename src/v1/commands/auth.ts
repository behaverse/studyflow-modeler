import type { CommandResult } from './types';

export type LoginAsGuestCommand = {
  type: 'login-as-guest';
};

export type LoginCommand = {
  type: 'login';
  apiKey: string;
};

export type AuthData = {
  apiKey?: string;
};

export function runLoginAsGuest(_command: LoginAsGuestCommand): CommandResult<AuthData> {
  return {
    success: true,
    data: {
      apiKey: 'guest',
    },
  };
}

export function runLogin(command: LoginCommand): CommandResult<AuthData> {
  const apiKey = command.apiKey;

  // TODO check key with behaverse data server
  if (apiKey !== '') {
    return {
      success: false,
      error: 'Invalid key',
    };
  }

  return {
    success: true,
    data: {
      apiKey,
    },
  };
}

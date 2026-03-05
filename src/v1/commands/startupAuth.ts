import type { CommandResult } from './types';

export type StartupAutoGuestCommand = {
  type: 'startup-auto-guest';
};

export type StartupLoginCommand = {
  type: 'startup-login';
  apiKey: string;
};

export type StartupGuestLoginCommand = {
  type: 'startup-guest-login';
};

export type StartupAuthData = {
  apiKey?: string;
  isOpen?: boolean;
};

export function runStartupAutoGuest(_command: StartupAutoGuestCommand): CommandResult<StartupAuthData> {
  return {
    success: true,
    data: {
      apiKey: 'guest',
    },
  };
}

export function runStartupLogin(command: StartupLoginCommand): CommandResult<StartupAuthData> {
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
      isOpen: false,
    },
  };
}

export function runStartupGuestLogin(_command: StartupGuestLoginCommand): CommandResult<StartupAuthData> {
  return {
    success: true,
    data: {
      apiKey: 'guest',
      isOpen: false,
    },
  };
}

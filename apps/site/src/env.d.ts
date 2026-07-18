/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    authResolved?: boolean;
    userContext?: {
      userId: string;
      username: string;
      role: 'owner' | 'standard' | 'guest';
      activeProfile?: string;
    };
  }
}

/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    userContext?: {
      userId: string;
      username: string;
      role: 'owner' | 'standard' | 'guest' | 'anonymous';
      activeProfile?: string;
    };
  }
}
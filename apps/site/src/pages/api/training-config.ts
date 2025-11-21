/**
 * API endpoint for retrieving training configuration from profile/etc/training.json
 *
 * GET: Returns the training configuration (base model, hyperparameters, etc.)
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core';

/**
 * GET handler - Retrieve training configuration
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);

    // Anonymous users get system-wide config
    if (user.role === 'anonymous') {
      const systemConfigPath = path.join(systemPaths.etc, 'training.json');

      if (!fs.existsSync(systemConfigPath)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Training configuration not found',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const content = fs.readFileSync(systemConfigPath, 'utf-8');
      const config = JSON.parse(content);

      return new Response(
        JSON.stringify(config),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Authenticated users get their profile-specific config
    const profilePaths = getProfilePaths(user.username);
    const userConfigPath = path.join(profilePaths.etc, 'training.json');

    // If user doesn't have training.json yet, try to copy from system defaults
    if (!fs.existsSync(userConfigPath)) {
      const systemConfigPath = path.join(systemPaths.etc, 'training.json');

      if (fs.existsSync(systemConfigPath)) {
        // Create user's etc directory if it doesn't exist
        fs.mkdirSync(profilePaths.etc, { recursive: true });

        // Copy system config as starting point
        const systemContent = fs.readFileSync(systemConfigPath, 'utf-8');
        fs.writeFileSync(userConfigPath, systemContent, 'utf-8');
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Training configuration not found',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Read and parse user's training config
    const content = fs.readFileSync(userConfigPath, 'utf-8');
    const config = JSON.parse(content);

    return new Response(
      JSON.stringify(config),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Failed to load training configuration',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

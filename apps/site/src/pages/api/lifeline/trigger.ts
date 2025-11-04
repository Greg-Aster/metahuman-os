import type { APIRoute } from 'astro';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Parse request body
    const body = await request.json();
    const source = body.source || 'unknown';

    // Audit the panic trigger
    audit({
      level: 'info',
      category: 'security',
      event: 'lifeline_panic',
      details: {
        source,
        timestamp: new Date().toISOString(),
        note: 'Theatrical trigger only - no actual emergency systems engaged',
      },
      actor: 'human',
    });

    // Return success
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Lifeline protocol triggered (simulation only)',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Lifeline trigger error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to trigger protocol',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * API endpoint to clear audit logs for privacy
 * DELETE /api/audit/clear - Deletes all audit log files
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '@metahuman/core';

export const DELETE: APIRoute = async ({ cookies }) => {
  try {
    // Check authentication - only authenticated users can clear logs
    const sessionCookie = cookies?.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const auditDir = path.join(paths.logs, 'audit');

    if (!fs.existsSync(auditDir)) {
      return new Response(
        JSON.stringify({ success: true, message: 'No audit logs to clear' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all audit log files
    const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.ndjson'));
    const deletedFiles: string[] = [];

    // Delete all audit log files
    for (const file of files) {
      const filePath = path.join(auditDir, file);
      try {
        fs.unlinkSync(filePath);
        deletedFiles.push(file);
      } catch (error) {
        console.warn(`Failed to delete audit log ${file}:`, error);
      }
    }

    // Audit the clear action itself (this will create a new log file)
    audit({
      level: 'info',
      category: 'security',
      event: 'audit_logs_cleared',
      details: {
        deletedFiles: deletedFiles.length,
        fileNames: deletedFiles,
        reason: 'User privacy request'
      },
      actor: 'user',
    });

    return new Response(
      JSON.stringify({
        success: true,
        deletedFiles: deletedFiles.length,
        message: `Cleared ${deletedFiles.length} audit log file(s)`
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

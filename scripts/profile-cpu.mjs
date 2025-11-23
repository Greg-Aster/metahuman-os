#!/usr/bin/env node
/**
 * CPU profiler for Node.js processes via Chrome DevTools Protocol
 * Connects to inspector, captures CPU profile, saves to file
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import WebSocket from 'ws';
import fs from 'fs';

const execAsync = promisify(exec);

const PID = process.argv[2] || '107002';
const DURATION_MS = parseInt(process.argv[3]) || 5000;
const OUTPUT_FILE = `/tmp/cpu-profile-${PID}.cpuprofile`;

console.log(`🔍 Profiling PID ${PID} for ${DURATION_MS}ms...`);

// Enable inspector
try {
  exec(`kill -USR1 ${PID}`, (err) => {
    if (err) console.warn('Inspector may already be enabled');
  });
} catch {}

// Wait for inspector to start
await new Promise(resolve => setTimeout(resolve, 1000));

// Get WebSocket URL
const { stdout } = await execAsync(`curl -s http://127.0.0.1:9229/json/list`);
const sessions = JSON.parse(stdout);
const wsUrl = sessions[0]?.webSocketDebuggerUrl;

if (!wsUrl) {
  console.error('❌ Failed to get WebSocket URL from inspector');
  process.exit(1);
}

console.log(`📡 Connecting to inspector...`);

const ws = new WebSocket(wsUrl);
let msgId = 1;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const msg = JSON.stringify({ id, method, params });

    const handler = (data) => {
      const response = JSON.parse(data);
      if (response.id === id) {
        ws.off('message', handler);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(msg);
  });
}

ws.on('open', async () => {
  try {
    console.log(`⏱️  Starting CPU profiler for ${DURATION_MS}ms...`);

    // Start profiling
    await send('Profiler.enable');
    await send('Profiler.start');

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, DURATION_MS));

    // Stop profiling and get data
    console.log(`📊 Stopping profiler and analyzing...`);
    const { profile } = await send('Profiler.stop');

    // Save profile
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profile, null, 2));
    console.log(`✅ Profile saved to: ${OUTPUT_FILE}`);

    // Analyze top functions
    const samples = profile.samples || [];
    const nodes = profile.nodes || [];
    const timeDeltas = profile.timeDeltas || [];

    // Count samples per function
    const hitCounts = {};
    samples.forEach(nodeId => {
      hitCounts[nodeId] = (hitCounts[nodeId] || 0) + 1;
    });

    // Sort by hit count
    const sorted = Object.entries(hitCounts)
      .map(([nodeId, count]) => {
        const node = nodes.find(n => n.id === parseInt(nodeId));
        return {
          name: node?.callFrame?.functionName || '(anonymous)',
          url: node?.callFrame?.url || '',
          count,
          percentage: ((count / samples.length) * 100).toFixed(1)
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    console.log(`\n🔥 Top CPU-consuming functions:\n`);
    sorted.forEach((fn, i) => {
      const fileName = fn.url ? fn.url.split('/').pop() : '';
      console.log(`${i + 1}. ${fn.percentage}% - ${fn.name} (${fileName})`);
    });

    ws.close();
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error:`, error.message);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (error) => {
  console.error(`❌ WebSocket error:`, error.message);
  process.exit(1);
});

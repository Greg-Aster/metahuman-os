/**
 * Deep Debug Skills Registration
 */
import { registerSkill as brainRegisterSkill } from '../../packages/core/src/skills.js';
import * as fsWrite from './fs_write';
import * as fsRead from './fs_read';
import * as searchIndex from './search_index';
import * as runAgent from './run_agent';
import * as shellSafe from './shell_safe';
import { listSkills as coreListSkills, getAvailableSkills as coreGetAvailableSkills, loadTrustLevel as coreLoadTrustLevel } from '../../packages/core/src/skills.js';

export function deepInitializeSkills(): void {
  console.log('[skills] Deep initializing skills registry...');
  
  // Log what we're about to register
  console.log('[skills] About to register fs_write skill with ID:', fsWrite.manifest.id);
  console.log('[skills] About to register fs_read skill with ID:', fsRead.manifest.id);
  
  // Register each skill with logging
  console.log('[skills] Registering fs_read...');
  brainRegisterSkill(fsRead.manifest, fsRead.execute);
  console.log('[skills] Registered fs_read. Current skills count:', coreListSkills().length);
  
  console.log('[skills] Registering fs_write...');
  brainRegisterSkill(fsWrite.manifest, fsWrite.execute);
  console.log('[skills] Registered fs_write. Current skills count:', coreListSkills().length);
  
  console.log('[skills] Registering search_index...');
  brainRegisterSkill(searchIndex.manifest, searchIndex.execute);
  console.log('[skills] Registered search_index. Current skills count:', coreListSkills().length);
  
  console.log('[skills] Registering run_agent...');
  brainRegisterSkill(runAgent.manifest, runAgent.execute);
  console.log('[skills] Registered run_agent. Current skills count:', coreListSkills().length);
  
  console.log('[skills] Registering shell_safe...');
  brainRegisterSkill(shellSafe.manifest, shellSafe.execute);
  console.log('[skills] Registered shell_safe. Current skills count:', coreListSkills().length);
  
  console.log('[skills] All skills registered. Final skills count:', coreListSkills().length);
  console.log('[skills] Final skills list:', coreListSkills().map(s => s.id));
}

async function deepDebugTest() {
  console.log('=== Deep Debug Skills Test ===');
  
  // Deep initialize skills
  console.log('Deep initializing skills...');
  deepInitializeSkills();
  
  const trustLevel = coreLoadTrustLevel();
  console.log('Trust level:', trustLevel);
  
  // List available skills
  console.log('All registered skills count:', coreListSkills().length);
  console.log('All registered skills:', coreListSkills().map(s => ({id: s.id, minTrustLevel: s.minTrustLevel})));
  
  const availableSkills = coreGetAvailableSkills(trustLevel);
  console.log('Available skills count:', availableSkills.length);
  console.log('Available skills:', availableSkills.map(s => s.id));
}

deepDebugTest().catch(console.error);
/**
 * Skills Registry Loader
 * Loads and registers all available skills
 */

import { registerSkill } from '../../packages/core/src/skills';

// Import all skills
import * as fsRead from './fs_read';
import * as fsWrite from './fs_write';
import * as searchIndex from './search_index';
import * as runAgent from './run_agent';
import * as shellSafe from './shell_safe';
import * as fsList from './fs_list';
import * as jsonUpdate from './json_update';
import * as httpGet from './http_get';
import * as summarizeFile from './summarize_file';
import * as fsDelete from './fs_delete';
import * as gitStatus from './git_status';
import * as gitCommit from './git_commit';
import * as webSearch from './web_search';
import * as taskCreate from './task_create';
import * as taskUpdateStatus from './task_update_status';
import * as taskList from './task_list';
import * as taskFind from './task_find';

/**
 * Initialize all skills
 * Call this at startup to register all available skills
 */
export function initializeSkills(): void {
  console.log('[skills] Initializing skills registry...');

  // Register each skill
  registerSkill(fsRead.manifest, fsRead.execute);
  registerSkill(fsWrite.manifest, fsWrite.execute);
  registerSkill(searchIndex.manifest, searchIndex.execute);
  registerSkill(runAgent.manifest, runAgent.execute);
  registerSkill(shellSafe.manifest, shellSafe.execute);
  registerSkill(fsList.manifest, fsList.execute);
  registerSkill(jsonUpdate.manifest, jsonUpdate.execute);
  registerSkill(httpGet.manifest, httpGet.execute);
  registerSkill(summarizeFile.manifest, summarizeFile.execute);
  registerSkill(fsDelete.manifest, fsDelete.execute);
  registerSkill(gitStatus.manifest, gitStatus.execute);
  registerSkill(gitCommit.manifest, gitCommit.execute);
  registerSkill(webSearch.manifest, webSearch.execute);
  registerSkill(taskCreate.manifest, taskCreate.execute);
  registerSkill(taskUpdateStatus.manifest, taskUpdateStatus.execute);
  registerSkill(taskList.manifest, taskList.execute);
  registerSkill(taskFind.manifest, taskFind.execute);

  console.log('[skills] Skills registered: fs_read, fs_write, fs_list, fs_delete, json_update, http_get, summarize_file, git_status, git_commit, search_index, run_agent, shell_safe, web_search, task_create, task_update_status, task_list, task_find');
}

// Export for convenience
export {
  fsRead,
  fsWrite,
  searchIndex,
  runAgent,
  shellSafe,
  webSearch,
  taskCreate,
  taskUpdateStatus,
  taskList,
  taskFind,
};

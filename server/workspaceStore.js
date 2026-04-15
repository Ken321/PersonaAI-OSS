import fs from 'node:fs/promises';
import path from 'node:path';

import { createDefaultPersonas } from './defaultPersonas.js';

const WORKSPACE_DIR = path.resolve(process.cwd(), '.personaai');
const WORKSPACE_PATH = path.join(WORKSPACE_DIR, 'workspace.json');

let workspaceState = null;
let operationQueue = Promise.resolve();

function createEmptyWorkspace() {
  const now = new Date().toISOString();
  return {
    meta: {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    projectSettings: {
      assigned_persona_ids: [],
      segment_settings: null,
      article_feedback_state: null,
      active_persona_id: null,
      media_info: null,
    },
    personas: createDefaultPersonas(),
    chatSessions: [],
    simulations: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDir() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
}

async function saveAtomic(workspace) {
  await ensureDir();
  const tmpPath = `${WORKSPACE_PATH}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, WORKSPACE_PATH);
}

function normalizeWorkspaceShape(raw) {
  const now = new Date().toISOString();
  const workspace = raw && typeof raw === 'object' ? raw : {};

  return {
    meta: {
      schemaVersion: 1,
      createdAt: workspace.meta?.createdAt || now,
      updatedAt: workspace.meta?.updatedAt || now,
    },
    projectSettings: {
      assigned_persona_ids: Array.isArray(workspace.projectSettings?.assigned_persona_ids)
        ? workspace.projectSettings.assigned_persona_ids
        : [],
      segment_settings: workspace.projectSettings?.segment_settings || null,
      article_feedback_state: workspace.projectSettings?.article_feedback_state || null,
      active_persona_id: workspace.projectSettings?.active_persona_id || null,
      media_info: workspace.projectSettings?.media_info || null,
    },
    personas: Array.isArray(workspace.personas) && workspace.personas.length > 0
      ? workspace.personas
      : createDefaultPersonas(),
    chatSessions: Array.isArray(workspace.chatSessions) ? workspace.chatSessions : [],
    simulations: Array.isArray(workspace.simulations) ? workspace.simulations : [],
  };
}

function markInterrupted(workspace) {
  let changed = false;
  workspace.simulations = workspace.simulations.map((simulation) => {
    if (simulation.status !== 'running') return simulation;
    changed = true;
    return {
      ...simulation,
      status: 'interrupted',
      updated_at: new Date().toISOString(),
    };
  });
  return changed;
}

export async function initWorkspaceStore() {
  if (workspaceState) return;

  await ensureDir();

  try {
    const raw = await fs.readFile(WORKSPACE_PATH, 'utf8');
    workspaceState = normalizeWorkspaceShape(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      workspaceState = createEmptyWorkspace();
      await saveAtomic(workspaceState);
      return;
    }

    const brokenPath = path.join(
      WORKSPACE_DIR,
      `workspace.broken-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    try {
      await fs.rename(WORKSPACE_PATH, brokenPath);
    } catch {}
    workspaceState = createEmptyWorkspace();
    await saveAtomic(workspaceState);
    return;
  }

  if (markInterrupted(workspaceState)) {
    workspaceState.meta.updatedAt = new Date().toISOString();
    await saveAtomic(workspaceState);
  }
}

export async function getWorkspace() {
  await operationQueue;
  await initWorkspaceStore();
  return clone(workspaceState);
}

export function updateWorkspace(mutator) {
  const run = async () => {
    await initWorkspaceStore();
    const draft = clone(workspaceState);
    const result = await mutator(draft);
    draft.meta.updatedAt = new Date().toISOString();
    workspaceState = draft;
    await saveAtomic(workspaceState);
    return clone(result === undefined ? draft : result);
  };

  operationQueue = operationQueue.then(run, run);
  return operationQueue;
}

export async function findPersonaById(personaId) {
  const workspace = await getWorkspace();
  return workspace.personas.find((persona) => persona.id === personaId) || null;
}

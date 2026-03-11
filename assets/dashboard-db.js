// Dashboard Supabase client
// Required in localStorage (optional for offline/local mode):
// - SB_URL
// - SB_ANON_KEY

(function () {
  const g = window;

  const FIXED_SB_URL = 'https://kzixjgzqyujqyjwvdgkn.supabase.co';
  const FIXED_SB_PUBLISHABLE_KEY = 'sb_publishable_ZpX-YNB5Av3mtNiIablq3w_JOPXMVxK';

  function getConfig() {
    const SB_URL = FIXED_SB_URL;
    const SB_ANON_KEY = FIXED_SB_PUBLISHABLE_KEY;
    const enabled = true;
    return { SB_URL, SB_ANON_KEY, enabled };
  }

  function getClient() {
    const cfg = getConfig();
    if (!cfg.enabled) return null;
    if (!g.supabase || !g.supabase.createClient) return null;
    return g.supabase.createClient(cfg.SB_URL, cfg.SB_ANON_KEY);
  }

  const TABLE_CANDIDATES = {
    projects: ['projects', 'project'],
    tickets: ['tickets', 'ticket'],
  };
  const RESOLVED_TABLES = { projects: null, tickets: null };

  function isRelationMissingError(error) {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return error?.code === 'PGRST205' || msg.includes('relation') && msg.includes('does not exist') || details.includes('schema cache');
  }

  async function resolveTableName(client, kind) {
    if (RESOLVED_TABLES[kind]) return RESOLVED_TABLES[kind];
    const candidates = TABLE_CANDIDATES[kind] || [];
    for (const tableName of candidates) {
      try {
        const { error } = await client.from(tableName).select('*').limit(1);
        // table exists if query succeeds OR fails for non-missing reasons (e.g. RLS/permission)
        if (!error || !isRelationMissingError(error)) {
          RESOLVED_TABLES[kind] = tableName;
          return tableName;
        }
      } catch (_) {}
    }
    return null;
  }

  // ---------- local fallback ----------
  const LS_PROJECTS = 'DASH_LOCAL_PROJECTS_V2';
  const LS_TICKETS = 'DASH_LOCAL_TICKETS_V2';
  const LS_USERS = 'DASH_LOCAL_USERS_V1';
  const LS_ACTIVITY = 'DASH_LOCAL_PROJECT_ACTIVITY_V1';
  const LS_OPEN_QUESTIONS = 'DASH_LOCAL_OPEN_QUESTIONS_V1';
  const LS_WHITEBOARDS = 'DASH_LOCAL_WHITEBOARDS_V1';
  const LS_ROLLBACKS = 'DASH_LOCAL_ROLLBACKS_V1';

  const DEFAULT_USERS = [
    { id: 'major', name: '少佐', icon: '/assets/major-icon.png' },
    { id: 'tachikoma', name: 'タチコマ', icon: '/assets/tachikoma-face.png' },
    { id: 'fuchikoma', name: 'フチコマ', icon: '/assets/fuchikoma-icon.png' },
    { id: 'batou', name: 'バトー', icon: null },
    { id: 'ishikawa', name: 'イシカワ', icon: null },
    { id: 'togusa', name: 'トグサ', icon: null },
    { id: 'boma', name: 'ボーマ', icon: null },
    { id: 'paz', name: 'パズ', icon: null },
    { id: 'saito', name: 'サイトー', icon: null },
    { id: 'laughingman', name: '笑い男', icon: null },
  ];

  function uid() {
    return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  function writeLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function ensureUsersSeed() {
    const cur = readLocal(LS_USERS);
    if (!cur.length) {
      writeLocal(LS_USERS, DEFAULT_USERS);
      return DEFAULT_USERS;
    }
    const byId = new Map(cur.map((u) => [u.id, u]));
    let changed = false;
    DEFAULT_USERS.forEach((u) => {
      if (!byId.has(u.id)) {
        byId.set(u.id, u);
        changed = true;
      }
    });
    const merged = Array.from(byId.values());
    if (changed) writeLocal(LS_USERS, merged);
    return merged;
  }

  function normalizeProjectLocalShape(project) {
    return {
      ...project,
      goal: project.goal || '',
      definition_of_done: Array.isArray(project.definition_of_done) ? project.definition_of_done : [],
      constraints: Array.isArray(project.constraints) ? project.constraints : [],
      links: Array.isArray(project.links) ? project.links : [],
    };
  }

  function summarizeAction(entityType, action, payload = {}) {
    const et = String(entityType || 'system');
    const ac = String(action || 'update');
    if (et === 'projects') {
      const title = payload.title || payload.project_key || '(project)';
      return `Project ${ac}: ${title}`;
    }
    if (et === 'tickets') {
      const t = payload.ticket_no || payload.title || '(ticket)';
      return `Ticket ${ac}: ${t}`;
    }
    if (et === 'project_comments') return `Project comment ${ac}`;
    if (et === 'ticket_comments') return `Ticket comment ${ac}`;
    if (et === 'open_questions') return `Open question ${ac}: ${payload.question_key || payload.title || '(question)'}`;
    if (et === 'project_rollbacks') return `Rollback ${ac}: ${payload.label || '(point)'}`;
    if (et === 'project_whiteboards') return `Whiteboard ${ac}: ${payload.board_key || '(board)'}`;
    return `${et} ${ac}`;
  }

  function appendLocalActivity({ projectId, actorId = null, entityType, entityId = null, action, payload = {}, summary = null }) {
    if (!projectId) return null;
    const rows = readLocal(LS_ACTIVITY);
    const created = {
      id: rows.length ? rows[0].id + 1 : 1,
      project_id: projectId,
      actor_id: actorId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      summary: summary || summarizeAction(entityType, action, payload),
      payload,
      created_at: new Date().toISOString(),
    };
    rows.unshift(created);
    writeLocal(LS_ACTIVITY, rows);
    return created;
  }

  function ensureLocalWhiteboard(project) {
    if (!project?.id) return null;
    const rows = readLocal(LS_WHITEBOARDS);
    const exists = rows.find((w) => w.project_id === project.id);
    if (exists) return exists;
    const created = {
      id: uid(),
      project_id: project.id,
      board_key: `wb_${(project.project_key || project.id.slice(0, 8)).replace(/-/g, '_')}`,
      title: `${project.title || 'Project'} Whiteboard`,
      board_url: null,
      board_state: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    rows.unshift(created);
    writeLocal(LS_WHITEBOARDS, rows);
    appendLocalActivity({
      projectId: project.id,
      entityType: 'project_whiteboards',
      entityId: created.id,
      action: 'insert',
      payload: created,
    });
    return created;
  }

  async function fetchUsers() {
    const local = ensureUsersSeed();
    const client = getClient();
    if (client) {
      try {
        const { data, error } = await client.from('app_users').select('id,name,icon_path').order('id');
        if (!error && data?.length) return data.map((u) => ({ id: u.id, name: u.name, icon: u.icon_path }));
      } catch (_) {}
    }
    return local;
  }

  async function fetchProjects(limit = 100) {
    let local = readLocal(LS_PROJECTS).map(normalizeProjectLocalShape);
    const client = getClient();
    let lastRemoteError = null;
    if (client) {
      const projectsTable = await resolveTableName(client, 'projects');
      if (!projectsTable) return local.slice(0, limit);
      try {
        const { data, error } = await client
          .from(projectsTable)
          .select('id, project_key, title, description, status, due_date, goal, definition_of_done, constraints, links, repo_url, default_branch, created_at, created_by')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        let remote = (data || []).map(normalizeProjectLocalShape);

        // if primary candidate is empty, probe other candidates (some environments have singular table names)
        if (!remote.length) {
          const candidates = (TABLE_CANDIDATES.projects || []).filter((t) => t !== projectsTable);
          for (const alt of candidates) {
            try {
              const { data: altData, error: altErr } = await client
                .from(alt)
                .select('id, project_key, title, description, status, due_date, goal, definition_of_done, constraints, links, repo_url, default_branch, created_at, created_by')
                .order('created_at', { ascending: false })
                .limit(limit);
              if (!altErr && altData?.length) {
                remote = altData.map(normalizeProjectLocalShape);
                RESOLVED_TABLES.projects = alt;
                break;
              }
            } catch (_) {}
          }
        }

        const merged = [...remote];
        const ids = new Set(remote.map((r) => r.id));
        local.forEach((r) => { if (!ids.has(r.id)) merged.push(r); });
        return merged.slice(0, limit);
      } catch (e) {
        lastRemoteError = e;
        // schema might not include new columns yet
        try {
          const { data, error } = await client
            .from(projectsTable)
            .select('id, project_key, title, description, status, due_date, created_at, created_by')
            .order('created_at', { ascending: false })
            .limit(limit);
          if (!error && data) {
            const remote = data.map(normalizeProjectLocalShape);
            const merged = [...remote];
            const ids = new Set(remote.map((r) => r.id));
            local.forEach((r) => { if (!ids.has(r.id)) merged.push(r); });
            return merged.slice(0, limit);
          }
          if (error) lastRemoteError = error;
        } catch (e2) {
          lastRemoteError = e2;
        }
      }
    }
    if (client && !local.length && lastRemoteError) {
      throw new Error(`projects fetch failed: ${lastRemoteError.message || String(lastRemoteError)}`);
    }
    throw new Error('DB_REQUIRED: projects');
  }

  async function createProject({
    projectKey,
    title,
    description = null,
    status = 'planning',
    dueDate = null,
    goal = '',
    definitionOfDone = [],
    constraints = [],
    links = [],
    repoUrl = null,
    defaultBranch = null,
    createdBy = null,
  }) {
    const client = getClient();
    if (client) {
      const row = {
        project_key: projectKey || null,
        title,
        description,
        status,
        due_date: dueDate,
        goal: goal || null,
        definition_of_done: Array.isArray(definitionOfDone) ? definitionOfDone : [],
        constraints: Array.isArray(constraints) ? constraints : [],
        links: Array.isArray(links) ? links : [],
        repo_url: repoUrl || null,
        default_branch: defaultBranch || null,
        created_by: createdBy,
        updated_by: createdBy,
      };
      if (!createdBy) {
        delete row.created_by;
        delete row.updated_by;
      }
      try {
        const { data, error } = await client.from('projects').insert(row).select('*').single();
        if (error) throw error;
        return normalizeProjectLocalShape(data);
      } catch (_) {
        // retry for legacy schema
        try {
          const legacy = {
            project_key: row.project_key,
            title: row.title,
            description: row.description,
            status: row.status,
            due_date: row.due_date,
            created_by: row.created_by,
            updated_by: row.updated_by,
          };
          if (!createdBy) {
            delete legacy.created_by;
            delete legacy.updated_by;
          }
          const { data, error } = await client.from('projects').insert(legacy).select('*').single();
          if (error) throw error;
          return normalizeProjectLocalShape(data);
        } catch (_) {
          // fall through to local
        }
      }
    }

    throw new Error('DB_REQUIRED: projects');
  }

  async function normalizeTicketStatuses() {
    const client = getClient();
    if (client) {
      try {
        const ticketsTable = await resolveTableName(client, 'tickets');
        if (ticketsTable) {
          const { data, error } = await client
            .from(ticketsTable)
            .select('id,status')
            .is('status', null)
            .limit(500);
          if (!error && data && data.length) {
            const ids = data.map((r) => r.id);
            await client.from(ticketsTable).update({ status: 'backlog' }).in('id', ids);
          }
        }
      } catch (_) {}
    }

    if (!client) throw new Error('DB_REQUIRED: tickets');
  }

  async function fetchTickets({ projectId = null, limit = 200 } = {}) {
    await normalizeTicketStatuses();
    let local = readLocal(LS_TICKETS).map((r) => ({ ...r, status: r.status || 'backlog', projects: { title: r.project_name || '-' } }));
    const client = getClient();
    let lastRemoteError = null;
    if (client) {
      const ticketsTable = await resolveTableName(client, 'tickets');
      if (ticketsTable) {
        try {
          let q = client
            .from(ticketsTable)
            .select('id, ticket_no, project_id, parent_ticket_id, title, description, completion_criteria, design, specification, working_branch, pr_url, status, due_date, assignee_id, sort_order, created_at, projects(title)')
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(limit);
          if (projectId) q = q.eq('project_id', projectId);
          const { data, error } = await q;
          if (error) throw error;
          let remote = (data || []).map((r) => ({ ...r, status: r.status || 'backlog' }));

          // if primary candidate is empty, probe other candidates (some environments have singular table names)
          if (!remote.length) {
            const candidates = (TABLE_CANDIDATES.tickets || []).filter((t) => t !== ticketsTable);
            for (const alt of candidates) {
              try {
                let q2 = client
                  .from(alt)
                  .select('id, ticket_no, project_id, parent_ticket_id, title, description, completion_criteria, design, specification, working_branch, pr_url, status, due_date, assignee_id, sort_order, created_at')
                  .order('sort_order', { ascending: true, nullsFirst: false })
                  .order('created_at', { ascending: false })
                  .limit(limit);
                if (projectId) q2 = q2.eq('project_id', projectId);
                const { data: altData, error: altErr } = await q2;
                if (!altErr && altData?.length) {
                  remote = altData.map((r) => ({ ...r, status: r.status || 'backlog', projects: { title: '-' } }));
                  RESOLVED_TABLES.tickets = alt;
                  break;
                }
              } catch (_) {}
            }
          }

          const merged = [...remote];
          const ids = new Set(remote.map((r) => r.id));
          local.forEach((r) => { if (!ids.has(r.id)) merged.push(r); });
          if (projectId) return merged.filter((r) => r.project_id === projectId).slice(0, limit);
          return merged.slice(0, limit);
        } catch (e) {
          lastRemoteError = e;
          // fallback for environments where FK relation (projects) is not available
          try {
            let q = client
              .from(ticketsTable)
              .select('id, ticket_no, project_id, parent_ticket_id, title, description, completion_criteria, design, specification, working_branch, pr_url, status, due_date, assignee_id, sort_order, created_at')
              .order('sort_order', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: false })
              .limit(limit);
            if (projectId) q = q.eq('project_id', projectId);
            const { data, error } = await q;
            if (!error && data) {
              const remote = data.map((r) => ({ ...r, status: r.status || 'backlog', projects: { title: '-' } }));
              const merged = [...remote];
              const ids = new Set(remote.map((r) => r.id));
              local.forEach((r) => { if (!ids.has(r.id)) merged.push(r); });
              if (projectId) return merged.filter((r) => r.project_id === projectId).slice(0, limit);
              return merged.slice(0, limit);
            }
            if (error) lastRemoteError = error;
          } catch (e2) {
            lastRemoteError = e2;
          }
        }
      }
    }

    if (client && !local.length && lastRemoteError) {
      throw new Error(`tickets fetch failed: ${lastRemoteError.message || String(lastRemoteError)}`);
    }

    throw new Error('DB_REQUIRED: tickets');
  }

  async function updateProject({ projectId, projectKey, title, description = null, status, dueDate = null, goal = '', definitionOfDone = [], constraints = [], links = [], repoUrl = null, defaultBranch = null }) {
    const client = getClient();
    if (client) {
      const row = {
        project_key: projectKey || null,
        title,
        description,
        status,
        due_date: dueDate,
        goal: goal || null,
        definition_of_done: Array.isArray(definitionOfDone) ? definitionOfDone : [],
        constraints: Array.isArray(constraints) ? constraints : [],
        links: Array.isArray(links) ? links : [],
        repo_url: repoUrl || null,
        default_branch: defaultBranch || null,
      };
      try {
        const { data, error } = await client.from('projects').update(row).eq('id', projectId).select('*').single();
        if (error) throw error;
        return normalizeProjectLocalShape(data);
      } catch (_) {
        try {
          const legacy = { project_key: row.project_key, title: row.title, description: row.description, status: row.status, due_date: row.due_date };
          const { data, error } = await client.from('projects').update(legacy).eq('id', projectId).select('*').single();
          if (error) throw error;
          return normalizeProjectLocalShape(data);
        } catch (_) {}
      }
    }
    throw new Error('DB_REQUIRED: projects');
  }

  async function deleteProject({ projectId }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: projects');

    const safeDelete = async (table, column, value) => {
      const { error } = await client.from(table).delete().eq(column, value);
      if (error && !isRelationMissingError(error)) throw error;
    };

    await safeDelete('tickets', 'project_id', projectId);
    await safeDelete('project_comments', 'project_id', projectId);
    await safeDelete('open_questions', 'project_id', projectId);
    await safeDelete('project_whiteboards', 'project_id', projectId);
    await safeDelete('project_rollbacks', 'project_id', projectId);

    const { error } = await client.from('projects').delete().eq('id', projectId);
    if (error) throw error;
    return true;
  }

  async function createTicket({ ticketNo, projectId, parentTicketId = null, title, description = null, completionCriteria = null, design = null, specification = null, workingBranch = null, prUrl = null, status = 'backlog', dueDate = null, assigneeId = null, createdBy = null }) {
    if (!projectId) throw new Error('project_id is required');
    if (!status) status = 'backlog';
    const client = getClient();
    if (client) {
      try {
        const row = {
          ticket_no: ticketNo || null,
          project_id: projectId,
          parent_ticket_id: parentTicketId,
          title,
          description,
          completion_criteria: completionCriteria,
          design,
          specification,
          working_branch: workingBranch,
          pr_url: prUrl,
          status,
          due_date: dueDate,
          assignee_id: assigneeId,
          created_by: createdBy,
          updated_by: createdBy,
        };
        if (!createdBy) {
          delete row.created_by;
          delete row.updated_by;
        }
        const { data, error } = await client.from('tickets').insert(row).select('*').single();
        if (error) throw error;
        return data;
      } catch (_) {}
    }

    throw new Error('DB_REQUIRED: tickets');
  }

  async function updateTicket({ ticketId, ticketNo, title, description = null, completionCriteria = null, design = null, specification = null, workingBranch = null, prUrl = null, status, dueDate = null, assigneeId = null }) {
    const client = getClient();
    if (client) {
      try {
        const { data: beforeRow } = await client.from('tickets').select('status').eq('id', ticketId).maybeSingle();
        const before = beforeRow?.status || null;
        const row = { ticket_no: ticketNo || null, title, description, completion_criteria: completionCriteria, design, specification, working_branch: workingBranch, pr_url: prUrl, status, due_date: dueDate, assignee_id: assigneeId };
        const { data, error } = await client.from('tickets').update(row).eq('id', ticketId).select('*').single();
        if (error) throw error;
        // NOTE: updateTicket は本文/メタ編集でも呼ばれるため、通知トリガーはここでは行わない。
        // ステータス遷移通知は updateTicketStatus / updateTicketBoard / reorderTickets のみで扱う。
        return data;
      } catch (_) {}
    }
    throw new Error('DB_REQUIRED: tickets');
  }

  async function deleteTicket({ ticketId }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: tickets');
    await client.from('ticket_comments').delete().eq('ticket_id', ticketId);
    const { data: current } = await client.from('tickets').select('id,project_id').eq('id', ticketId).maybeSingle();
    const { error } = await client.from('tickets').delete().eq('id', ticketId);
    if (error) throw error;
    return { ok: true, project_id: current?.project_id || null };
  }

  async function maybeNotifyStatusTransition({ before = null, after = null, source = 'dashboard_db' } = {}) {
    try {
      if (!after || !after.status) return;
      const toStatus = after.status;
      const isTodoTransition = before !== 'todo' && toStatus === 'todo';
      const isInProgressTransition = before !== 'in_progress' && toStatus === 'in_progress';
      const isQaBlockedTransition = before !== 'qa_blocked' && toStatus === 'qa_blocked';
      if (!isTodoTransition && !isInProgressTransition && !isQaBlockedTransition) return;

      await pushToTachikoma({
        type: isTodoTransition ? 'ticket_todo_detected' : (isInProgressTransition ? 'ticket_in_progress_detected' : 'ticket_qa_blocked_detected'),
        ticket_id: after.id || null,
        project_id: after.project_id || null,
        ticket_no: after.ticket_no || null,
        title: after.title || null,
        description: after.description || null,
        completion_criteria: after.completion_criteria || null,
        design: after.design || null,
        specification: after.specification || null,
        working_branch: after.working_branch || null,
        pr_url: after.pr_url || null,
        parent_ticket_id: after.parent_ticket_id || null,
        from_status: before,
        to_status: toStatus,
        source,
      });

      if (isQaBlockedTransition && after.project_id) {
        const detail = `ticket_id=${after.id || ''}\nstatus=qa_blocked\n${after.description || ''}`;
        await upsertOpenQuestion({
          projectId: after.project_id,
          questionKey: after.ticket_no || null,
          title: after.title || '(no title)',
          detail,
          status: 'open',
        });
      }
    } catch (_) {}
  }

  async function updateTicketStatus({ ticketId, status }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: tickets');
    const { data: beforeRow } = await client.from('tickets').select('status').eq('id', ticketId).maybeSingle();
    const before = beforeRow?.status || null;
    const { data, error } = await client
      .from('tickets')
      .update({ status })
      .eq('id', ticketId)
      .select('*')
      .single();
    if (error) throw error;
    await maybeNotifyStatusTransition({ before, after: data, source: 'update_ticket_status' });
    return data;
  }

  async function updateTicketBoard({ ticketId, status, sortOrder = null }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: tickets');
    const { data: beforeRow } = await client.from('tickets').select('status').eq('id', ticketId).maybeSingle();
    const before = beforeRow?.status || null;
    const patch = { status };
    if (sortOrder !== null && sortOrder !== undefined) patch.sort_order = sortOrder;
    const { data, error } = await client
      .from('tickets')
      .update(patch)
      .eq('id', ticketId)
      .select('*')
      .single();
    if (error) throw error;
    await maybeNotifyStatusTransition({ before, after: data, source: 'update_ticket_board' });
    return data;
  }

  async function reorderTickets({ items = [] }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: tickets');
    const ids = [...new Set((items || []).map((it) => it?.id).filter(Boolean))];
    let beforeMap = new Map();
    if (ids.length) {
      const { data: beforeRows } = await client.from('tickets').select('id,status').in('id', ids);
      beforeMap = new Map((beforeRows || []).map((r) => [r.id, r.status || null]));
    }

    for (const it of items) {
      const { error } = await client.from('tickets').update({ sort_order: it.sort_order, status: it.status }).eq('id', it.id);
      if (error) throw error;
    }

    if (ids.length) {
      const { data: afterRows } = await client
        .from('tickets')
        .select('id,project_id,ticket_no,title,description,completion_criteria,design,specification,parent_ticket_id,status')
        .in('id', ids);
      for (const row of (afterRows || [])) {
        await maybeNotifyStatusTransition({
          before: beforeMap.get(row.id) || null,
          after: row,
          source: 'reorder_tickets',
        });
      }
    }

    return { ok: true, count: items.length };
  }

  async function insertProjectComment({ projectId, body, createdBy }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_comments');
    const { data, error } = await client
      .from('project_comments')
      .insert({ project_id: projectId, body, created_by: createdBy })
      .select('id, project_id, body, created_by, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function insertTicketComment({ ticketId, body, createdBy }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: ticket_comments');
    const { data, error } = await client
      .from('ticket_comments')
      .insert({ ticket_id: ticketId, body, created_by: createdBy })
      .select('id, ticket_id, body, created_by, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function insertTicketAttachment({ ticketId, fileName, mimeType = null, fileSize = null, contentBase64, createdBy = null }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: ticket_attachments');
    const { data, error } = await client
      .from('ticket_attachments')
      .insert({ ticket_id: ticketId, file_name: fileName, mime_type: mimeType, file_size: fileSize, content_base64: contentBase64, created_by: createdBy })
      .select('id, ticket_id, file_name, mime_type, file_size, content_base64, created_by, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function fetchTicketAttachments(ticketId, limit = 100) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: ticket_attachments');
    const { data, error } = await client
      .from('ticket_attachments')
      .select('id, ticket_id, file_name, mime_type, file_size, content_base64, created_by, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function fetchProjectComments(projectId, limit = 30) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_comments');
    const { data, error } = await client
      .from('project_comments')
      .select('id, project_id, body, created_by, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function fetchTicketComments(ticketId, limit = 30) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: ticket_comments');
    const { data, error } = await client
      .from('ticket_comments')
      .select('id, ticket_id, body, created_by, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function fetchProjectActivity(projectId, limit = 50) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_activity_logs');
    const { data, error } = await client
      .from('project_activity_logs')
      .select('id, project_id, actor_id, entity_type, entity_id, action, summary, payload, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function fetchOpenQuestions(projectId, { includeResolved = false, limit = 50 } = {}) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: open_questions');
    let q = client
      .from('open_questions')
      .select('id, project_id, question_key, title, detail, status, created_by, resolved_by, created_at, updated_at, resolved_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!includeResolved) q = q.in('status', ['open', 'in_talk']);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function upsertOpenQuestion({ id = null, projectId, questionKey = null, title, detail = '', status = 'open', createdBy = null, resolvedBy = null }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: open_questions');
    const row = {
      project_id: projectId,
      question_key: questionKey,
      title,
      detail,
      status,
      created_by: createdBy,
      resolved_by: resolvedBy,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    };
    if (id) {
      const { data, error } = await client.from('open_questions').update(row).eq('id', id).select('*').single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await client.from('open_questions').insert(row).select('*').single();
    if (error) throw error;
    return data;
  }

  async function fetchProjectWhiteboard(projectId) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_whiteboards');
    const { data, error } = await client
      .from('project_whiteboards')
      .select('id, project_id, board_key, title, board_url, board_state, created_at, updated_at')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function upsertProjectWhiteboard({ projectId, boardKey = null, title = null, boardUrl = null, boardState = {} }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_whiteboards');
    const current = await fetchProjectWhiteboard(projectId);
    const row = {
      project_id: projectId,
      board_key: boardKey || current?.board_key || `wb_${String(projectId).slice(0, 8)}`,
      title: title || current?.title || 'Project Whiteboard',
      board_url: boardUrl ?? current?.board_url ?? null,
      board_state: boardState || current?.board_state || {},
    };
    if (current?.id) {
      const { data, error } = await client.from('project_whiteboards').update(row).eq('id', current.id).select('*').single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await client.from('project_whiteboards').insert(row).select('*').single();
    if (error) throw error;
    return data;
  }

  async function fetchRollbackPoints(projectId, limit = 30) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_rollbacks');
    const { data, error } = await client
      .from('project_rollbacks')
      .select('id, project_id, label, note, snapshot, created_by, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function createRollbackPoint({ projectId, label, note = '', snapshot = {}, createdBy = null }) {
    const client = getClient();
    if (!client) throw new Error('DB_REQUIRED: project_rollbacks');
    const { data, error } = await client
      .from('project_rollbacks')
      .insert({ project_id: projectId, label, note, snapshot, created_by: createdBy })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  function subscribeProjectComments(projectId, onInsert) {
    const client = getClient();
    if (!client) return () => {};
    const channel = client
      .channel(`project-comments-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_comments', filter: `project_id=eq.${projectId}` },
        (payload) => onInsert?.(payload.new)
      )
      .subscribe();
    return () => client.removeChannel(channel);
  }

  function subscribeTicketComments(ticketId, onInsert) {
    const client = getClient();
    if (!client) return () => {};
    const channel = client
      .channel(`ticket-comments-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_comments', filter: `ticket_id=eq.${ticketId}` },
        (payload) => onInsert?.(payload.new)
      )
      .subscribe();
    return () => client.removeChannel(channel);
  }

  function subscribeProjectTickets(projectId, onChange) {
    const client = getClient();
    if (!client) return () => {};
    const channel = client
      .channel(`project-tickets-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `project_id=eq.${projectId}` }, (payload) => onChange?.(payload))
      .subscribe();
    return () => client.removeChannel(channel);
  }

  async function pushToTachikoma(event) {
    const cfg = getConfig();
    if (!cfg.enabled) return;
    const url = `${cfg.SB_URL}/functions/v1/on-comment-created`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.SB_ANON_KEY,
        Authorization: `Bearer ${cfg.SB_ANON_KEY}`,
      },
      body: JSON.stringify(event),
    });
  }

  async function fetchProjectById(projectId) {
    const rows = await fetchProjects(500);
    return rows.find((r) => r.id === projectId) || null;
  }

  async function fetchTicketById(ticketId) {
    const rows = await fetchTickets({ limit: 1000 });
    return rows.find((r) => r.id === ticketId) || null;
  }

  ensureUsersSeed();

  g.DashboardDB = {
    getConfig,
    getClient,
    fetchUsers,
    fetchProjects,
    fetchProjectById,
    createProject,
    updateProject,
    deleteProject,
    fetchTickets,
    fetchTicketById,
    createTicket,
    updateTicket,
    deleteTicket,
    updateTicketStatus,
    updateTicketBoard,
    reorderTickets,
    insertProjectComment,
    insertTicketComment,
    insertTicketAttachment,
    fetchProjectComments,
    fetchTicketComments,
    fetchTicketAttachments,
    fetchProjectActivity,
    fetchOpenQuestions,
    upsertOpenQuestion,
    fetchProjectWhiteboard,
    upsertProjectWhiteboard,
    fetchRollbackPoints,
    createRollbackPoint,
    subscribeProjectComments,
    subscribeTicketComments,
    subscribeProjectTickets,
    pushToTachikoma,
  };
})();

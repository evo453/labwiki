// ============================================================
// LabWiki Scheduler - Cloudflare Worker
// 按需部署：收到申请 → 创建 Railway 服务 → 返回公网地址
// 自动清理：心跳超时 → 删除 Railway 服务 → 释放资源
// ============================================================

// ---- 配置常量 ----
const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';
const PROJECT_ID = '9b5f1680-73ef-4e99-a9dd-439395897b28';
const ENVIRONMENT_ID = 'a2f41d00-06a2-44d5-bc28-aa0b32562ef7';
const GITHUB_REPO = 'evo453/labwiki';
const SERVICE_PREFIX = 'labwiki';
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;  // 5 分钟无心跳视为闲置
const DEPLOY_STUCK_MS = 15 * 60 * 1000;       // 部署超过 15 分钟视为卡死

// ---- CORS ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function reply(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ---- Railway GraphQL 调用 ----
async function railGql(env, query, variables) {
  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RAILWAY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// ---- KV 读写 ----
async function getState(env) {
  const raw = await env.LABWIKI_STATE.get('deployment');
  return raw ? JSON.parse(raw) : { phase: 'idle' };
}

async function saveState(env, state) {
  await env.LABWIKI_STATE.put('deployment', JSON.stringify(state));
}

// ---- 删除 Railway 服务 ----
async function deleteService(env, serviceId) {
  try {
    await railGql(env,
      'mutation($id: String!) { serviceDelete(id: $id) }',
      { id: serviceId }
    );
  } catch (e) {
    // 忽略删除失败（可能已被手动删除）
  }
}

// ---- GET /status ----
async function handleStatus(env) {
  const s = await getState(env);

  if (s.phase === 'idle') {
    return reply({ status: 'idle' });
  }
  if (s.phase === 'ready' && s.url) {
    return reply({ status: 'ready', url: s.url });
  }
  if (s.phase === 'deploying') {
    // 主动检查 Railway 部署进度
    if (s.serviceId) {
      try {
        const depRes = await railGql(env, `
          query($input: DeploymentListInput!, $first: Int) {
            deployments(input: $input, first: $first) {
              edges { node { id status url createdAt } }
            }
          }
        `, {
          input: { projectId: PROJECT_ID, serviceId: s.serviceId, environmentId: ENVIRONMENT_ID },
          first: 1
        });

        const dep = depRes.data?.deployments?.edges?.[0]?.node;
        if (dep) {
          if (dep.status === 'SUCCESS') {
            // 拿域名
            let url = dep.url;
            try {
              const domRes = await railGql(env, `
                query($projectId: String!, $environmentId: String!, $serviceId: String!) {
                  domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
                    serviceDomains { domain suffix }
                  }
                }
              `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: s.serviceId });
              const sd = domRes.data?.domains?.serviceDomains?.[0];
              if (sd) url = `https://${sd.domain}.${sd.suffix}`;
            } catch (_) {}

            s.phase = 'ready';
            s.url = url;
            s.lastHb = Date.now();
            await saveState(env, s);
            return reply({ status: 'ready', url });
          }
          if (['FAILED', 'CRASHED', 'REMOVED'].includes(dep.status)) {
            await saveState(env, { phase: 'idle' });
            return reply({ status: 'error', message: '部署失败: ' + dep.status });
          }
          return reply({ status: 'deploying', phase: dep.status, message: '当前状态: ' + dep.status });
        }
      } catch (_) {}
    }
    return reply({ status: 'deploying', message: '正在准备知识库...' });
  }
  return reply({ status: s.phase });
}

// ---- POST /apply ----
async function handleApply(env) {
  const s = await getState(env);

  // 已有就绪服务且心跳未过期 → 直接返回
  if (s.phase === 'ready' && s.url) {
    const since = Date.now() - (s.lastHb || 0);
    if (since < HEARTBEAT_TIMEOUT_MS) {
      return reply({ status: 'ready', url: s.url, message: '知识库已在线' });
    }
    // 心跳过期，清理后重新创建
    await deleteService(env, s.serviceId);
    await saveState(env, { phase: 'idle' });
  }

  // 正在部署中 → 返回当前状态
  if (s.phase === 'deploying') {
    return reply({ status: 'deploying', message: '知识库正在准备中，请稍候...' });
  }

  // ---- 开始部署 ----
  const t0 = Date.now();
  await saveState(env, { phase: 'deploying', t0 });

  try {
    // 1) 创建服务
    const svcSuffix = String(t0 % 10000);  // 避免重名
    const svcRes = await railGql(env, `
      mutation($input: ServiceCreateInput!) {
        serviceCreate(input: $input) { id name }
      }
    `, {
      input: {
        projectId: PROJECT_ID,
        name: `${SERVICE_PREFIX}-${svcSuffix}`,
        source: { repo: GITHUB_REPO }
      }
    });

    if (svcRes.errors) {
      throw new Error(svcRes.errors[0].message);
    }
    const serviceId = svcRes.data.serviceCreate.id;

    // 2) 触发部署
    await saveState(env, { phase: 'deploying', t0, serviceId });

    const depRes = await railGql(env, `
      mutation($input: EnvironmentTriggersDeployInput!) {
        environmentTriggersDeploy(input: $input)
      }
    `, {
      input: { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, serviceId }
    });

    if (depRes.errors) {
      throw new Error(depRes.errors[0].message);
    }

    await saveState(env, { phase: 'deploying', t0, serviceId, deployedAt: Date.now() });

    return reply({
      status: 'deploying',
      serviceId,
      message: '部署已触发，预计 1-2 分钟完成'
    });

  } catch (err) {
    const cur = await getState(env);
    if (cur.serviceId) await deleteService(env, cur.serviceId);
    await saveState(env, { phase: 'idle' });
    return reply({ status: 'error', message: err.message }, 500);
  }
}

// ---- POST /heartbeat ----
async function handleHeartbeat(env) {
  const s = await getState(env);
  s.lastHb = Date.now();
  await saveState(env, s);
  return reply({ ok: true });
}

// ---- 自动清理（Cron 触发） ----
async function autoCleanup(env) {
  const s = await getState(env);

  // 就绪但心跳超时 → 删除
  if (s.phase === 'ready' && s.serviceId) {
    const since = Date.now() - (s.lastHb || s.t0 || 0);
    if (since > HEARTBEAT_TIMEOUT_MS) {
      await deleteService(env, s.serviceId);
      await saveState(env, { phase: 'idle' });
      console.log('Auto-cleanup: deleted idle service', s.serviceId);
    }
  }

  // 部署卡死 → 清理
  if (s.phase === 'deploying') {
    const since = Date.now() - (s.t0 || 0);
    if (since > DEPLOY_STUCK_MS) {
      if (s.serviceId) await deleteService(env, s.serviceId);
      await saveState(env, { phase: 'idle' });
      console.log('Auto-cleanup: deleted stuck deployment', s.serviceId);
    }
  }
}

// ---- 主入口 ----
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    switch (url.pathname) {
      case '/apply':   return request.method === 'POST' ? handleApply(env) : reply({ error: 'use POST' }, 405);
      case '/status':  return handleStatus(env);
      case '/heartbeat': return handleHeartbeat(env);
      case '/health':  return reply({ ok: true });
      default:         return reply({ error: 'not found' }, 404);
    }
  },

  async scheduled(event, env) {
    await autoCleanup(env);
  }
};

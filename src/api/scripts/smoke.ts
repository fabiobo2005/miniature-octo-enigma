type CheckResult = {
  name: string;
  ok: boolean;
  status?: number;
  skipped?: boolean;
  detail: string;
};

const DEFAULT_BASE_URL = 'https://ca-apex-web.jollyglacier-b0e801ab.centralus.azurecontainerapps.io';
const baseUrl = (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

function icon(result: CheckResult): string {
  if (result.skipped) return '⚠️';
  return result.ok ? '✅' : '❌';
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

async function checkArrayEndpoint(name: string, path: string, minCount: number): Promise<CheckResult> {
  try {
    const { status, body } = await getJson(path);
    if (status < 200 || status >= 300) {
      return { name, ok: false, status, detail: `HTTP ${status}` };
    }
    if (!Array.isArray(body)) {
      return { name, ok: false, status, detail: 'resposta não é um array JSON' };
    }
    if (body.length < minCount) {
      return { name, ok: false, status, detail: `retornou ${body.length}; esperado ≥${minCount}` };
    }
    return { name, ok: true, status, detail: `retornou ${body.length}; esperado ≥${minCount}` };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkOptionalHealthz(): Promise<CheckResult> {
  const name = 'GET /healthz';
  try {
    const { status } = await getJson('/healthz');
    if (status === 404) {
      return { name, ok: true, status, skipped: true, detail: 'não existe neste deploy; skip' };
    }
    if (status < 200 || status >= 300) {
      return { name, ok: false, status, detail: `HTTP ${status}` };
    }
    return { name, ok: true, status, detail: 'healthz OK' };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  console.log(`Smoke tests APEX API`);
  console.log(`Base URL: ${baseUrl}`);
  console.log('');

  const results = await Promise.all([
    checkArrayEndpoint('GET /api/treinos/programas', '/api/treinos/programas', 15),
    checkArrayEndpoint('GET /api/treinos/personals', '/api/treinos/personals', 2),
    checkOptionalHealthz(),
  ]);

  for (const result of results) {
    const status = result.status ? ` (${result.status})` : '';
    console.log(`${icon(result)} ${result.name}${status} — ${result.detail}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.log('');
    console.error(`❌ Smoke falhou: ${failures.length} check(s) com erro.`);
    process.exit(1);
  }

  console.log('');
  console.log('✅ Smoke concluído sem falhas obrigatórias.');
}

main().catch((error: unknown) => {
  console.error('❌ Smoke falhou com erro inesperado:', error instanceof Error ? error.message : error);
  process.exit(1);
});

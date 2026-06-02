const ALLOWED_SURFACES = new Set(["canonical", "legacy", "mixed"]);

export function validateSurface(value) {
  if (!ALLOWED_SURFACES.has(value)) {
    throw new Error(`invalid contractSurface: ${String(value)}`);
  }
  return value;
}

export function createCheckRecorder() {
  const checks = [];

  function pass(name, details, contractSurface = "mixed") {
    checks.push({
      name,
      ok: true,
      details,
      contractSurface: validateSurface(contractSurface),
    });
  }

  function fail(name, reason, contractSurface = "mixed") {
    checks.push({
      name,
      ok: false,
      reason: reason instanceof Error ? reason.message : String(reason),
      contractSurface: validateSurface(contractSurface),
    });
  }

  async function check(name, fn, contractSurface = "mixed") {
    try {
      const details = await fn();
      pass(name, details, contractSurface);
      return true;
    } catch (error) {
      fail(name, error, contractSurface);
      return false;
    }
  }

  return { checks, pass, fail, check };
}

export function summarizeChecks(checks) {
  const surfaces = {
    canonical: { total: 0, failed: 0 },
    legacy: { total: 0, failed: 0 },
    mixed: { total: 0, failed: 0 },
  };
  for (const item of checks) {
    const surface = validateSurface(item.contractSurface ?? "mixed");
    surfaces[surface].total += 1;
    if (!item.ok) surfaces[surface].failed += 1;
  }
  return {
    total: checks.length,
    failed: checks.filter((item) => !item.ok).length,
    surfaces,
  };
}

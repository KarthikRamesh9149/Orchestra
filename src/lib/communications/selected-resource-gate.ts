export type SelectedResourceScope = {
  type: string;
  id: string;
};

export type SelectedResourceAccessDecision =
  | {
      allowed: true;
      matched: SelectedResourceScope;
    }
  | {
      allowed: false;
      reason: "no_selected_resources" | "resource_not_selected" | "resource_unknown";
    };

export function evaluateSelectedResourceAccess(input: {
  selected: SelectedResourceScope[];
  candidates: Array<SelectedResourceScope | null | undefined>;
  fallbackScope?: SelectedResourceScope | null;
}): SelectedResourceAccessDecision {
  const selected = normalizeScopes(input.selected);
  if (selected.length === 0) {
    return { allowed: false, reason: "no_selected_resources" };
  }

  const candidates = normalizeScopes(input.candidates);
  for (const candidate of candidates) {
    const matched = selected.find((scope) => sameScope(scope, candidate));
    if (matched) {
      return { allowed: true, matched };
    }
  }

  const fallbackScope = normalizeScope(input.fallbackScope ?? null);
  if (fallbackScope) {
    const matched = selected.find((scope) => sameScope(scope, fallbackScope));
    if (matched) {
      return { allowed: true, matched };
    }
    return { allowed: false, reason: "resource_not_selected" };
  }

  return { allowed: false, reason: candidates.length > 0 ? "resource_not_selected" : "resource_unknown" };
}

export function selectedScopesFromIds(type: string, ids: string[]): SelectedResourceScope[] {
  return ids
    .map((id) => normalizeScope({ type, id }))
    .filter((scope): scope is SelectedResourceScope => Boolean(scope));
}

function normalizeScopes(scopes: Array<SelectedResourceScope | null | undefined>): SelectedResourceScope[] {
  return scopes
    .map((scope) => normalizeScope(scope ?? null))
    .filter((scope): scope is SelectedResourceScope => Boolean(scope));
}

function normalizeScope(scope: SelectedResourceScope | null): SelectedResourceScope | null {
  const type = scope?.type?.trim();
  const id = scope?.id?.trim();
  if (!type || !id) return null;
  return { type, id };
}

function sameScope(left: SelectedResourceScope, right: SelectedResourceScope) {
  return left.type === right.type && left.id === right.id;
}

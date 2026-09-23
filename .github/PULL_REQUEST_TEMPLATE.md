<!-- Escribe primero en español sencillo (quien revisa puede no ser técnico) y luego en inglés. Sin emojis. / Write the plain-language summary in Spanish first, then English. No emojis. -->

## Resumen (Español)

<!-- 2-4 frases sencillas: qué problema había y qué hace este cambio, como se lo contarías a alguien no técnico. -->

## Summary (English)

<!-- The same plain-language summary in English. -->

## Qué cambia / What changes

-

## Cómo probar / How to test

1.

<!-- Technical evidence below, per docs/ai/pr-evidence.md. CI (type-check, lint, unit suites, TDD gate, script tests, agent lint) runs on its own; this section covers what CI cannot see. -->

## Change Type

<!-- One or more: UI / user-facing · Backend / API · Database · Bug fix · Refactor · Performance · Infrastructure · Workflow tooling -->

-

## Evidence

<!-- What docs/ai/pr-evidence.md requires for the Change Type(s) above. -->

## Testing

- Commands executed:
- Tests passed:
- Manual verification performed:
- Important cases covered:

## TDD evidence

- Test Matrix (layer | required / not required | file):
- RED run (`bun run tdd:red` output from before implementing):
- Waivers, one per line, only if used (the CI `tdd:gate` reads these lines):
  <!-- TDD-Waiver: <reason> -->
  <!-- E2E-Waiver: <reason> -->
  <!-- Migration-Waiver: <reason> -->

## Risk

- Possible regressions:
- Backward-compatibility concerns:
- Data impact:
- Security impact (workspace isolation, auth, rate limits / token budgets):

## Rollback

- Exact steps to revert safely:

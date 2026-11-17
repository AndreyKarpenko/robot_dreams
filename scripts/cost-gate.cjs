require('ts-node/register/transpile-only');
const { readFileSync } = require('node:fs');
const { planCost } = require('../src/mapping.ts');
function read(path) {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }
}
const cost = planCost(read(process.env.PLAN_JSON));
const baseline = process.env.BASE_PLAN_JSON
  ? planCost(read(process.env.BASE_PLAN_JSON))
  : 0;
const budget = Number(process.env.COST_BUDGET_USD ?? 10);
if (!Number.isFinite(budget) || budget < 0) throw new Error('Invalid budget');
const delta = cost - baseline;
const bypass = process.env.COST_APPROVED === '1';
const pass = delta <= budget || bypass;
console.log(
  `budget-usd=${budget}\nplan-usd=${cost.toFixed(6)}\nbaseline-usd=${baseline.toFixed(6)}\ndelta-usd=${delta.toFixed(6)}\nbypass=${Number(bypass)}\ngate=${pass ? 'pass' : 'fail'}`,
);
process.exitCode = pass ? 0 : 1;

import test from 'node:test';
import assert from 'node:assert/strict';
import { goalMilestone } from '../src/lib/goal-milestone.js';
test('meta cresce em passos de 20%, incluindo os limites exatos', () => {
  for (const [sold, percent] of [[224999.99,100],[225000,120],[241678,120],[269999.99,120],[270000,140],[315000,160],[450000,220]]) {
    assert.equal(goalMilestone({target:225000,sold}).percent,percent);
  }
});
test('falta, pace e ritmo diário usam o mesmo próximo alvo', () => {
  assert.deepEqual(goalMilestone({target:225000,sold:241678,expectedProgress:15/22,remainingBusinessDays:8}), {
    percent:120,target:270000,missing:28322,paceDelta:57587.09,requiredDailyPace:3540.25,
  });
});
test('período encerrado conserva a meta; sem meta e sem dias não divide por zero', () => {
  assert.equal(goalMilestone({target:225000,sold:241678,ended:true}).percent,100);
  assert.equal(goalMilestone({target:0,sold:1}),null);
  assert.equal(goalMilestone({target:null}),null);
  assert.equal(goalMilestone({target:225000,sold:241678}).requiredDailyPace,null);
});

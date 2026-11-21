import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_TEMPLATES,
  appendPromptTemplate,
  getPromptTemplateById,
} from './promptTemplates';

test('PROMPT_TEMPLATES includes Cyberpunk neon, 1970s film noir, and Studio Ghibli style with non-empty snippets', () => {
  const labels = PROMPT_TEMPLATES.map((t) => t.label);
  assert.ok(labels.includes('Cyberpunk neon'));
  assert.ok(labels.includes('1970s film noir'));
  assert.ok(labels.includes('Studio Ghibli style'));

  const seenIds = new Set<string>();
  for (const template of PROMPT_TEMPLATES) {
    assert.ok(template.id.length > 0);
    assert.ok(!seenIds.has(template.id), `duplicate template id: ${template.id}`);
    seenIds.add(template.id);
    assert.ok(template.label.trim().length > 0);
    assert.ok(template.promptSnippet.trim().length >= 20);
  }
});

test('appendPromptTemplate fills empty prompt, appends cleanly to existing prompt, and skips duplicates', () => {
  const noir = getPromptTemplateById('1970s-film-noir')!;
  const cyber = getPromptTemplateById('cyberpunk-neon')!;

  assert.equal(appendPromptTemplate('', '1970s-film-noir'), noir.promptSnippet);
  assert.equal(appendPromptTemplate('   ', '1970s-film-noir'), noir.promptSnippet);

  const appended = appendPromptTemplate('Детектив идёт по улице', '1970s-film-noir');
  assert.equal(appended, `Детектив идёт по улице, ${noir.promptSnippet}`);

  const withPeriod = appendPromptTemplate('Детектив идёт по улице.', 'cyberpunk-neon');
  assert.equal(withPeriod, `Детектив идёт по улице. ${cyber.promptSnippet}`);

  // Selecting the same template twice should not duplicate the snippet
  assert.equal(appendPromptTemplate(appended, '1970s-film-noir'), appended);

  // Unknown template id leaves prompt unchanged
  assert.equal(appendPromptTemplate('Тест', 'unknown-template'), 'Тест');
});

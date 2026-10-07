import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { submitSchema, searchSchema } from '../dist/validation.js';

test('submission trims text and rejects empty/oversized fields', () => {
  const schema = z.object(submitSchema);
  assert.equal(schema.parse({ text: '  hello  ' }).text, 'hello');
  for (const value of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(8001) }, { text: 'ok', tags: Array(21).fill('tag') }, { text: 'ok', tags: [''] }, { text: 'ok', geo: 'x'.repeat(201) }, { text: 'ok', category: '' }]) {
    assert.equal(schema.safeParse(value).success, false);
  }
});

test('search requires UUID and bounded integer limit', () => {
  const schema = z.object(searchSchema);
  const item_id = '123e4567-e89b-42d3-a456-426614174000';
  assert.ok(schema.safeParse({ item_id, limit: 10 }).success);
  for (const value of [{ item_id: 'not-a-uuid' }, { item_id, limit: 0 }, { item_id, limit: 51 }, { item_id, limit: 1.5 }]) {
    assert.equal(schema.safeParse(value).success, false);
  }
});

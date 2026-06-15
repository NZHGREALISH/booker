import assert from 'node:assert/strict';
import { parseSlotMenuSelection } from './booker.js';

assert.deepEqual(parseSlotMenuSelection('13,12,11'), [
  '8 - 8:50 PM',
  '7 - 7:55 PM',
  '6 - 6:55 PM',
]);

assert.deepEqual(parseSlotMenuSelection('11-13'), [
  '6 - 6:55 PM',
  '7 - 7:55 PM',
  '8 - 8:50 PM',
]);

assert.deepEqual(parseSlotMenuSelection('13-11'), [
  '8 - 8:50 PM',
  '7 - 7:55 PM',
  '6 - 6:55 PM',
]);

assert.deepEqual(parseSlotMenuSelection('pm'), [
  '12 - 12:55 PM',
  '1 - 1:55 PM',
  '2 - 2:55 PM',
  '3 - 3:55 PM',
  '5 - 5:55 PM',
  '6 - 6:55 PM',
  '7 - 7:55 PM',
  '8 - 8:50 PM',
]);

console.log('Menu parser tests passed.');

import assert from 'node:assert/strict';
import {
  buildDateChoices,
  formatBookingDateText,
  formatLocalIsoDate,
  parseSlotMenuSelection,
} from './booker.js';

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

const fixedDate = new Date(2026, 5, 14, 9, 30, 0, 0);
assert.equal(formatLocalIsoDate(fixedDate), '2026-06-14');
assert.equal(formatBookingDateText(fixedDate), 'Jun 14, 2026');
assert.deepEqual(buildDateChoices(fixedDate).map((choice) => `${choice.label}:${choice.isoDate}:${choice.dateText}`), [
  'Today:2026-06-14:Jun 14, 2026',
  'Tomorrow:2026-06-15:Jun 15, 2026',
  'Day after tomorrow:2026-06-16:Jun 16, 2026',
]);

console.log('Menu parser tests passed.');

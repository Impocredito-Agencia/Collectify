import { isWithinBusinessHours } from './businessHours';

// Times given as explicit UTC instants (Bogotá = UTC-5, no DST) — each
// case's comment states the equivalent Bogotá local time.
describe('isWithinBusinessHours', () => {
  it('is open on a weekday mid-morning (Tuesday 10am Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-08T15:00:00Z'))).toBe(true);
  });

  it('is closed on a weekday before 9am (Tuesday 8:59am Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-08T13:59:00Z'))).toBe(false);
  });

  it('is open right at the weekday opening boundary (Tuesday 9:00am Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-08T14:00:00Z'))).toBe(true);
  });

  it('is closed at the weekday closing boundary (Tuesday 7:00pm Bogotá, i.e. Wednesday 00:00 UTC)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-09T00:00:00Z'))).toBe(false);
  });

  it('is open just before the weekday closing boundary (Tuesday 6:59pm Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-08T23:59:00Z'))).toBe(true);
  });

  it('is open on a Saturday afternoon (Saturday 3pm Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-12T20:00:00Z'))).toBe(true);
  });

  it('is closed on a Saturday at the 4pm closing boundary (Saturday 4:00pm Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-12T21:00:00Z'))).toBe(false);
  });

  it('is closed on a Saturday evening, even though it would still be open on a weekday (Saturday 6pm Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-12T23:00:00Z'))).toBe(false);
  });

  it('is closed all day Sunday (Sunday noon Bogotá)', () => {
    expect(isWithinBusinessHours(new Date('2026-09-13T17:00:00Z'))).toBe(false);
  });
});

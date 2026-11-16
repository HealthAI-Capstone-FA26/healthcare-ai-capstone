import {
  APPOINTMENT_STATUS_TRANSITIONS,
  AppointmentStatus as S,
  canCancelAppointment,
  isValidAppointmentTransition,
} from '../../src/common/utils/appointment-status.util';

describe('Appointment state machine (state transition tests)', () => {
  const valid: [S, S][] = [
    [S.PENDING, S.CONFIRMED],
    [S.PENDING, S.CANCELLED],
    [S.PENDING, S.NO_SHOW],
    [S.CONFIRMED, S.CHECKED_IN],
    [S.CONFIRMED, S.CANCELLED],
    [S.CONFIRMED, S.NO_SHOW],
    [S.CHECKED_IN, S.IN_PROGRESS],
    [S.CHECKED_IN, S.NO_SHOW],
    [S.IN_PROGRESS, S.COMPLETED],
  ];

  it.each(valid)('allows %s -> %s', (from, to) => {
    expect(isValidAppointmentTransition(from, to)).toBe(true);
  });

  const invalid: [S, S][] = [
    [S.PENDING, S.CHECKED_IN],
    [S.CONFIRMED, S.PENDING],
    [S.CHECKED_IN, S.CONFIRMED],
    [S.CHECKED_IN, S.CANCELLED],
    [S.IN_PROGRESS, S.CANCELLED],
    [S.COMPLETED, S.PENDING],
    [S.CANCELLED, S.CONFIRMED],
    [S.NO_SHOW, S.CONFIRMED],
  ];

  it.each(invalid)('rejects %s -> %s', (from, to) => {
    expect(isValidAppointmentTransition(from, to)).toBe(false);
  });

  it('terminal states have no outgoing transition', () => {
    for (const s of [S.COMPLETED, S.CANCELLED, S.NO_SHOW]) {
      expect(APPOINTMENT_STATUS_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('unknown status is never a valid source', () => {
    expect(isValidAppointmentTransition('bogus', S.CONFIRMED)).toBe(false);
  });

  it('canCancelAppointment: only pending/confirmed', () => {
    expect(canCancelAppointment(S.PENDING)).toBe(true);
    expect(canCancelAppointment(S.CONFIRMED)).toBe(true);
    expect(canCancelAppointment(S.CHECKED_IN)).toBe(false);
    expect(canCancelAppointment(S.COMPLETED)).toBe(false);
  });
});

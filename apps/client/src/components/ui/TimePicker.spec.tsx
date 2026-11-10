import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TimePicker } from './TimePicker';

function Harness({ initial }: { initial: [number, number] }) {
  const [[hour, minute], setTime] = useState(initial);
  return (
    <>
      <TimePicker
        hour={hour}
        minute={minute}
        onChange={(nextHour, nextMinute) => setTime([nextHour, nextMinute])}
        className=""
        ariaLabel="Hora del envío"
      />
      <output data-testid="value">{`${hour}:${minute}`}</output>
    </>
  );
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Hora del envío' }));
}

describe('TimePicker', () => {
  it('shows the time in 12-hour es-CO format', () => {
    render(<Harness initial={[9, 0]} />);
    expect(screen.getByText('09:00 a. m.')).toBeTruthy();
  });

  it('opens a panel with the current hour, minute and period selected', () => {
    render(<Harness initial={[15, 30]} />);
    open();
    const selected = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-selected') === 'true')
      .map((button) => button.textContent);
    expect(selected).toEqual(['03', '30', 'p. m.']);
  });

  it('changes hour, minute and period, keeping the rest', () => {
    render(<Harness initial={[9, 0]} />);
    open();
    const pick = (column: string, value: string) =>
      fireEvent.click(
        within(screen.getByRole('listbox', { name: column })).getByRole(
          'button',
          { name: value },
        ),
      );

    pick('Hora', '10');
    expect(screen.getByTestId('value').textContent).toBe('10:0');

    pick('Min', '45');
    expect(screen.getByTestId('value').textContent).toBe('10:45');

    pick('a. m. / p. m.', 'p. m.');
    expect(screen.getByTestId('value').textContent).toBe('22:45');

    pick('Hora', '12');
    expect(screen.getByTestId('value').textContent).toBe('12:45');
  });

  it('closes with Listo and with Escape', () => {
    render(<Harness initial={[9, 0]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

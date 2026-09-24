import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DecimalInput } from './DecimalInput';

function Harness({ initial }: { initial: number | '' }) {
  const [value, setValue] = useState<number | ''>(initial);
  return (
    <>
      <DecimalInput
        value={value}
        onChange={setValue}
        className=""
        ariaLabel="valor"
      />
      <output data-testid="parsed">{value === '' ? 'vacío' : value}</output>
    </>
  );
}

function type(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe('DecimalInput', () => {
  it('can be cleared without turning into a 0, then retyped', () => {
    render(<Harness initial={3.9} />);
    const input = screen.getByLabelText('valor') as HTMLInputElement;

    type(input, '');
    expect(input.value).toBe('');
    expect(screen.getByTestId('parsed').textContent).toBe('vacío');

    type(input, '2');
    type(input, '2.');
    type(input, '2.4');
    expect(input.value).toBe('2.4');
    expect(screen.getByTestId('parsed').textContent).toBe('2.4');
  });

  it('turns a typed comma into a dot', () => {
    render(<Harness initial="" />);
    const input = screen.getByLabelText('valor') as HTMLInputElement;

    type(input, '2,');
    expect(input.value).toBe('2.');
    type(input, '2,4');
    expect(input.value).toBe('2.4');
    expect(screen.getByTestId('parsed').textContent).toBe('2.4');
  });

  it('ignores characters that are not part of a decimal number', () => {
    render(<Harness initial={2} />);
    const input = screen.getByLabelText('valor') as HTMLInputElement;

    type(input, '2a');
    expect(input.value).toBe('2');
    type(input, '2.4.5');
    expect(input.value).toBe('2');
  });

  it('keeps a lone dot as empty', () => {
    render(<Harness initial="" />);
    const input = screen.getByLabelText('valor') as HTMLInputElement;

    type(input, '.');
    expect(input.value).toBe('.');
    expect(screen.getByTestId('parsed').textContent).toBe('vacío');
  });
});

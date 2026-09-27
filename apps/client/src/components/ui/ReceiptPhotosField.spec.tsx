import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReceiptPhotosField } from './ReceiptPhotosField';

function pickFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]');
  if (!input) {
    throw new Error('file input not found');
  }
  fireEvent.change(input, { target: { files } });
}

describe('ReceiptPhotosField', () => {
  beforeEach(() => {
    // jsdom has no object-URL support.
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${(counter += 1)}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('reports every picked photo to the caller and shows a thumbnail for each', () => {
    const onChange = vi.fn();
    const { container } = render(<ReceiptPhotosField onChange={onChange} />);
    const first = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const second = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    pickFiles(container, [first]);
    pickFiles(container, [second]);

    expect(onChange).toHaveBeenLastCalledWith([first, second]);
    expect(screen.getAllByAltText('Vista previa del comprobante')).toHaveLength(
      2,
    );
  });

  it('removes one photo and tells the caller', () => {
    const onChange = vi.fn();
    const { container } = render(<ReceiptPhotosField onChange={onChange} />);
    const first = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const second = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    pickFiles(container, [first, second]);

    fireEvent.click(screen.getAllByText('Quitar')[0]);

    expect(onChange).toHaveBeenLastCalledWith([second]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(screen.getAllByAltText('Vista previa del comprobante')).toHaveLength(
      1,
    );
  });

  it('starts empty and does not call back until something is picked', () => {
    const onChange = vi.fn();
    render(<ReceiptPhotosField onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Vista previa del comprobante')).toBeNull();
  });
});
